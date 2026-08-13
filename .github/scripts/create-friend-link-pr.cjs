'use strict';

const FRIEND_LINKS_PATH = 'friendlinks.json';
const COMMENT_MARKER = '<!-- friend-link-automation -->';

const FIELD_BY_HEADING = new Map([
  ['站点名称', 'name'],
  ['站点地址', 'url'],
  ['站点简介', 'bio'],
  ['头像地址', 'avatar'],
  ['背景图地址', 'backgroundImage'],
  ['RSS 或 Atom 地址', 'rss'],
]);

const URL_FIELDS = ['url', 'avatar', 'backgroundImage', 'rss'];
const OPTIONAL_FIELDS = ['bio', 'avatar', 'backgroundImage', 'rss'];

class InputError extends Error {}

function normalizeResponse(value) {
  const normalized = value.replace(/\r\n/g, '\n').trim();

  if (/^_?(?:No response|未提供响应)_?$/i.test(normalized)) {
    return '';
  }

  return normalized;
}

function parseIssueBody(body) {
  const headings = [...String(body || '').matchAll(/^###\s+(.+?)\s*$/gm)]
    .map((match) => ({
      heading: match[1].trim(),
      start: match.index,
      valueStart: match.index + match[0].length,
    }))
    .filter(({ heading }) => FIELD_BY_HEADING.has(heading));

  const fields = {};

  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    const value = String(body || '').slice(
      current.valueStart,
      next ? next.start : undefined,
    );

    // If a response contains a heading that looks like a later form field, the
    // real generated heading appears afterwards and safely replaces this value.
    fields[FIELD_BY_HEADING.get(current.heading)] = normalizeResponse(value);
  }

  return fields;
}

function parseHttpUrl(fieldName, value) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new InputError(`${fieldName} 必须是完整的 URL`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new InputError(`${fieldName} 只支持 http 或 https URL`);
  }

  if (parsed.username || parsed.password) {
    throw new InputError(`${fieldName} 不能包含用户名或密码`);
  }

  return value;
}

function validateFields(fields) {
  const name = String(fields.name || '').trim();
  const url = String(fields.url || '').trim();

  if (!name) {
    throw new InputError('缺少“站点名称”');
  }

  if (!url) {
    throw new InputError('缺少“站点地址”');
  }

  if (name.length > 100) {
    throw new InputError('“站点名称”不能超过 100 个字符');
  }

  if (String(fields.bio || '').length > 1000) {
    throw new InputError('“站点简介”不能超过 1000 个字符');
  }

  for (const fieldName of URL_FIELDS) {
    const value = String(fields[fieldName] || '').trim();

    if (!value) {
      continue;
    }

    if (value.length > 2048) {
      throw new InputError(`${fieldName} 不能超过 2048 个字符`);
    }

    parseHttpUrl(fieldName, value);
  }

  const entry = { name, url };

  for (const fieldName of OPTIONAL_FIELDS) {
    const value = String(fields[fieldName] || '').trim();

    if (value) {
      entry[fieldName] = value;
    }
  }

  return entry;
}

function comparableUrl(value) {
  const parsed = new URL(value);
  parsed.hash = '';

  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString().replace(/\/$/, '');
}

function containsUrl(friendLinks, url) {
  const expected = comparableUrl(url);

  return friendLinks.some((friendLink) => {
    try {
      return comparableUrl(friendLink.url) === expected;
    } catch {
      return false;
    }
  });
}

async function readFriendLinks(github, repo, ref) {
  const response = await github.rest.repos.getContent({
    ...repo,
    path: FRIEND_LINKS_PATH,
    ref,
  });

  if (Array.isArray(response.data) || response.data.type !== 'file') {
    throw new Error(`${FRIEND_LINKS_PATH} 不是文件`);
  }

  const source = Buffer.from(
    response.data.content.replace(/\n/g, ''),
    'base64',
  ).toString('utf8');
  const friendLinks = JSON.parse(source);

  if (!Array.isArray(friendLinks)) {
    throw new Error(`${FRIEND_LINKS_PATH} 的顶层结构必须是数组`);
  }

  return {
    friendLinks,
    sha: response.data.sha,
  };
}

async function findOpenPullRequest(github, repo, branch, base) {
  const response = await github.rest.pulls.list({
    ...repo,
    state: 'open',
    head: `${repo.owner}:${branch}`,
    base,
    per_page: 1,
  });

  return response.data[0];
}

async function ensureBranch(github, repo, branch, baseSha) {
  try {
    await github.rest.git.getRef({
      ...repo,
      ref: `heads/${branch}`,
    });
    return;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  try {
    await github.rest.git.createRef({
      ...repo,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
  } catch (error) {
    // A duplicate opened/labeled delivery can race with this run.
    if (error.status !== 422) {
      throw error;
    }
  }
}

async function upsertIssueComment(github, repo, issueNumber, message) {
  const body = `${COMMENT_MARKER}\n${message}`;
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  const existing = comments.find(
    (comment) =>
      comment.user?.type === 'Bot' && comment.body?.includes(COMMENT_MARKER),
  );

  if (existing) {
    await github.rest.issues.updateComment({
      ...repo,
      comment_id: existing.id,
      body,
    });
    return;
  }

  await github.rest.issues.createComment({
    ...repo,
    issue_number: issueNumber,
    body,
  });
}

async function createFriendLinkPullRequest({ github, context, core }) {
  const repo = context.repo;
  const issue = context.payload.issue;
  const issueNumber = issue.number;
  const defaultBranch = context.payload.repository.default_branch;
  const branch = `automation/friend-link-${issueNumber}`;
  let entry;

  try {
    entry = validateFields(parseIssueBody(issue.body));
  } catch (error) {
    if (!(error instanceof InputError)) {
      throw error;
    }

    await upsertIssueComment(
      github,
      repo,
      issueNumber,
      `无法生成友链 PR：${error.message}。请按照友链 Issue 模板补全资料后，重新添加 \`friend-link\` 标签。`,
    );
    core.setFailed(error.message);
    return;
  }

  const existingPullRequest = await findOpenPullRequest(
    github,
    repo,
    branch,
    defaultBranch,
  );

  if (existingPullRequest) {
    await upsertIssueComment(
      github,
      repo,
      issueNumber,
      `友链 PR 已存在：#${existingPullRequest.number}`,
    );
    return;
  }

  const baseRef = await github.rest.git.getRef({
    ...repo,
    ref: `heads/${defaultBranch}`,
  });
  const baseFile = await readFriendLinks(github, repo, defaultBranch);

  if (containsUrl(baseFile.friendLinks, entry.url)) {
    await upsertIssueComment(
      github,
      repo,
      issueNumber,
      `\`${FRIEND_LINKS_PATH}\` 中已经存在相同的站点地址，因此没有重复创建 PR。`,
    );
    return;
  }

  await ensureBranch(github, repo, branch, baseRef.data.object.sha);

  const branchFile = await readFriendLinks(github, repo, branch);

  if (!containsUrl(branchFile.friendLinks, entry.url)) {
    branchFile.friendLinks.push(entry);

    await github.rest.repos.createOrUpdateFileContents({
      ...repo,
      path: FRIEND_LINKS_PATH,
      branch,
      sha: branchFile.sha,
      message: `feat: add friend link from #${issueNumber}`,
      content: Buffer.from(
        `${JSON.stringify(branchFile.friendLinks, null, 2)}\n`,
        'utf8',
      ).toString('base64'),
    });
  }

  const pullRequest = await github.rest.pulls.create({
    ...repo,
    title: `feat: 添加友链 ${entry.name}`,
    head: branch,
    base: defaultBranch,
    body: [
      '此 PR 由友链申请 Issue 自动生成，将申请内容追加到 `friendlinks.json`。',
      '',
      `Closes #${issueNumber}`,
    ].join('\n'),
    maintainer_can_modify: true,
  });

  await upsertIssueComment(
    github,
    repo,
    issueNumber,
    `已创建友链 PR：#${pullRequest.data.number}。合并后本 Issue 会自动关闭。`,
  );
}

module.exports = createFriendLinkPullRequest;
module.exports.parseIssueBody = parseIssueBody;
module.exports.validateFields = validateFields;

