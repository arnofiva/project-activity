# Github Project Activity

This action emails a summary of recent project activity in a repo and generates an artifact of the summary

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

**Required** Sender user password

### `email-from`

**Required** Sender from name

### `recipient-emails`

**Required** Recipient email addresses

### `project-numbers`

**Required** Project Numbers

### `days`

**Required** Days back

## Outputs

### artifact file with summary in html

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
              uses: ./.github/actions/project
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