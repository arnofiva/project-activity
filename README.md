# Github Project Activity

Using a github Project kanban boards for tracking issues? 
For a specified number of recent days, this action generates a summary of project board activity, both as an email and an artifact.  

For example, schedule the action to run each Monday morning to receive a summary of the past 7 days activity showing moved isses, new issues and issues with new comments.

See a sample summary (once viewing the sample, mouse over the link of an issue to see a tool tip summarising its flow through kanban columns):
    * <a href="http://htmlpreview.github.com/?https://github.com/adgcz/project-activity/blob/main/sample.html">sample email content</a>

## Inputs

### `token`

**Required** Github Token

### `smtp-server`

**Required** SMTP Server

### `smtp-server-port`

**Required** SMTP Server Port

### `auth-user`

**Required** Sender user email

### `auth-pwd`

**Required** Sender user password (for gmail, you can use an app password)

### `email-from`

**Required** Sender from name

### `recipient-emails`

**Required** Recipient email addresses (comma-separated)

### `project-numbers`

**Required** Project Numbers (comma-separated) or all

### `days`

**Required** Days back (number of days to query from current date backwards)

## Outputs

Generates email with project activity summary and sends to specified recipients
Uploads an artifact file associated to each action run, with the same project activity summary

## Example usage

```yaml
on:
  schedule:
    # * is a special character in YAML so you have to quote this string
    - cron:  '1 8 * * 1'
jobs:
    testing-project:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v2
            - name: Project changes past 7 days
              uses: adgcz/project-activity@v1.0.0
              id: project
              with:
                  token: ${{ secrets.GITHUB_TOKEN }}
                  smtp-server: "smtp.gmail.com"
                  smtp-server-port: "587"
                  auth-user: ${{ secrets.EMAIL_USER }}
                  auth-pwd: ${{ secrets.EMAIL_PWD }}
                  email-from: ${{ secrets.EMAIL_FROM }}
                  recipient-emails: ${{ secrets.RECIPIENT_EMAILS }}
                  project-numbers: all
                  days: 7
            - name: Upload summary to artifacts
              uses: actions/upload-artifact@v1
              with:
                  name: kanban
                  path: kanban
```