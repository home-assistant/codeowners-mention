/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */

const codeownersUtils = require('codeowners-utils')

module.exports = app => {
  app.on(['issues.labeled', 'pull_request.labeled'], async context => {
    const labelName = context.payload.label.name
    const triggerType = (context.name === "issues") ? 'issue' : 'pull_request'
    const triggerURL = context.payload[triggerType].html_url

    if(labelName.indexOf('integration: ') === -1) return;

    const params = context.repo({path: 'CODEOWNERS'})
    const codeownersData = await context.github.repos.getContents(params)

    const integrationName = labelName.split('integration: ')[1];

    const path = `homeassistant/components/${integrationName}/*`

    const str = Buffer.from(codeownersData.data.content, 'base64').toString()

    if(str.indexOf(integrationName) === -1) {
      console.log(`Integration named ${integrationName} not in CODEOWNERS, exiting during processing of ${triggerURL}`)
      return;
    }

    const entries = parse(str)
    const match = codeownersUtils.matchFile(path, entries)

    if(!match) {
      console.log(`No match found in CODEOWNERS for ${path}, exiting during processing of ${triggerURL}`)
      return;
    }

    const codeownersLine = `${codeownersData.data.html_url}#L${match.line}`

    const getMaxParams = context.issue({per_page: 100})

    const issue = await context.github.issues.get(context.issue())
    const assignees = issue.data.assignees.map(assignee => assignee.login.toLowerCase())

    const commentersData = await context.github.issues.listComments(getMaxParams)
    const commenters = commentersData.data.map(commenter => commenter.user.login.toLowerCase())

    const usernames = match.owners.map(rawUsername => rawUsername.substring(1))

    const mentions = usernames.filter(username => {
      return context.payload.issue.user.login != username && assignees.indexOf(username) === -1 && commenters.indexOf(username) === -1
    })

    const triggerLabel = (context.name === "issues") ? 'issue' : 'pull request'

    const commentBody = `Hey there ${mentions.join(', ')}, mind taking a look at this ${triggerLabel} as its been labeled with a integration (\`${integrationName}\`) you are listed as a [codeowner](${codeownersLine}) for? Thanks!`

    console.log(`Adding comment to ${triggerLabel} ${triggerURL}: ${commentBody}`)

    await context.github.issues.addAssignees(context.issue({assignees: usernames}))

    if(mentions.length === 0) {
      return
    }

    const issueComment = context.issue({ body: commentBody })
    return context.github.issues.createComment(issueComment)
  })
}

// Temporary local patched version of whats in codeowners-utils
// until https://github.com/jamiebuilds/codeowners-utils/pull/1 is merged
function parse(str) {
  let entries = []
  let lines = str.split("\n")

  lines.forEach((entry, idx) => {
    let [content, comment] = entry.split("#")
    let trimmed = content.trim()
    if (trimmed === "") return
    let [pattern, ...owners] = trimmed.split(/\s+/)
    let line = idx + 1
    entries.push({ pattern, owners, line })
  })

  return entries.reverse()
}
