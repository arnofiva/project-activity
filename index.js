/* eslint-disable no-await-in-loop */

const core = require('@actions/core');
const { Octokit } = require('@octokit/rest');
const { dirname } = require('path');
const { appendFileSync } = require('fs');
const makeDir = require('make-dir');

class HTMLReporter {
  static drawKanban(projectName, projectUrl, columns, daysAgo, removedIssues) {
    const today = new Date();
    const groups = ['No change', 'Moved here', 'Added', 'Reopened', 'Closed', 'Removed'];
    return (
      `<br/>
      <div class="project"><span class="projectname">
        <a href="${projectUrl}">${projectName}</a>
        </span>
        <br/> past ${daysAgo} days activity (as at ${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()})${removedIssues.length > 0 ? `<div class="removed"><span class="grouphead">Removed issues</span><br/>${removedIssues.map((issue) => (
        `<a title="" href="${issue.html_url}" class="group0">${issue.title}</a>`
      )).join('')}</div>`
        : ''
      }<table><tr>${columns
        .map((element) => (
          `<td><div class="column">${element.name
          }</div>${element.issues.length === 0
            ? '<div style="text-align:center;">No issues</div>'
            : element.issues
              .map((issue, i, arr) => (
                `${(i > 0 && arr[i - 1].group !== issue.group ? '</div>' : '')
                + (i === 0 || arr[i - 1].group !== issue.group ? `<br/><div class="grouping${issue.group}"><div class="grouphead">${groups[issue.group]}</div>` : '')
                }<li><a title="${issue.flow}" href="${issue.html_url}" class="group${issue.group}">${issue.title}</a> ${issue.periodComments > 0 ? ` <a class="comments" title="${issue.periodComments} of ${issue.totalComments}" href="${issue.html_url}">new comments</a>` : ''}</li>${i === arr.length - 1 ? '</div>' : ''}`
              ))
              .join('')
          }</td>`
        ))
        .join('')
      }</tr></table>`
      + '</div><br/>'
    );
  }

  static write(kanbans) {
    // TODO: can CSS be input?
    const cssStyle = `<style> 
                ul {padding: 12px;} 
                ul li {list-style-type: circle;} 
                .removed {align: center; width: 100%; padding: 4px; vertical-align: top; text-align:left;}  
                .project {overflow-x:auto; text-align: center; }  
                .projectname {font-size:large; font-weight: bold; }  
                a.comments {color:purple; font-style: italic; font-size: small; font-weight: bold;}  
                .grouphead  {font-style: italic; text-align: center; } 
                .grouping0  {background-color: #f0efef;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; } 
                .grouping1  {background-color: #ddeedd;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; } 
                .grouping2  {background-color: #c2d4dd;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; } 
                .grouping3  {background-color: #eaece5;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; } 
                .grouping4  {background-color: #b2c2bf;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; } 
                .grouping5  {background-color: #f0efef;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }
                .column { font-weight: bold; text-align: center;    } 
                table { width: 100%; padding: 4px; border-spacing: 4px;} 
                td {background-color: #f0efef; width:150px; padding: 8px; vertical-align: top; text-align:left; border: 1px solid #cccccc;  border-radius: 6px;}  
            </style>`;

    const htmlKanban = kanbans.map((k) => this.drawKanban(k));

    return `<html>
            <head>
                ${cssStyle}
            </head>
            <body>
                ${htmlKanban}
            </body>
        </html>`;
  }
}

async function run() {
  try {
    const token = core.getInput('token');
    // scope of data
    const projectNumbers = core.getInput('project-numbers'); // secret
    const phaseCalendarDays = core.getInput('days'); //

    let projectsToQuery = [];

    if (projectNumbers.toLowerCase() !== 'all') {
      try {
        projectsToQuery = projectNumbers.split(',');
      } catch (error) {
        // invalid project number list
      }
    }

    let daysToQuery = 7;
    if (!Number.isNaN(phaseCalendarDays)) {
      daysToQuery = parseInt(phaseCalendarDays, 10);
    }

    const octokit = new Octokit({
      auth: token,
      previews: ['starfox-preview', 'inertia-preview'],
    });
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

    // get open projects in repo
    const repoProjects = await octokit.request(
      'GET /repos/:owner/:repo/projects',
      {
        owner,
        repo,
      },
    );

    // get repo issues updated in last 30 days
    const since = new Date(new Date().getTime() - (30 * 1000 * 3600 * 24));
    const issuesSince = await octokit.request(
      'GET /repos/{owner}/{repo}/issues',
      {
        owner,
        repo,
        since,
      },
    );

    // for issues updated in last 30 days, get removals and additions to projects
    const removeEvents = [];
    for (let i = 0; i < issuesSince.data.length; i += 1) {
      const updateIssueEvents = await octokit.request(
        'GET /repos/{owner}/{repo}/issues/:issue_number/events',
        {
          owner,
          repo,
          issue_number: issuesSince.data[i].number,
        },
      );

      const removals = updateIssueEvents.data.filter(
        (ev) => (
          (ev.event === 'removed_from_project' || ev.event === 'added_to_project')
        ),
      );

      // sort date ascending
      removals.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));

      // save relevant events for issue
      const keys = Object.keys(removals);
      keys.forEach((key) => {
        removeEvents.push(
          {
            issue_number: issuesSince.data[i].number,
            event: removals[key].event,
            created_at: removals[key].created_at,
            html_url: issuesSince.data[i].html_url,
            title: issuesSince.data[i].title,
            project_id: removals[key].project_card.project_id,
          },
        );
      });
    }

    // iterate projects in repo
    const projectKanbans = [];
    for (let p = 0; p < repoProjects.data.length; p += 1) {
      if (
        projectsToQuery.length === 0
        || projectsToQuery.toLowerCase() === 'all'
        || projectsToQuery.indexOf(
          repoProjects.data[p].number.toString(),
        ) > -1
      ) {
        // get columns for project
        const projectId = repoProjects.data[p].id;
        const columns = await octokit.request(
          'GET /projects/:project_id/columns',
          {
            owner,
            repo,
            project_id: repoProjects.data[p].id,
          },
        );

        // info for summary
        const kanbanColumns = columns.data.map((element) => ({
          name: element.name,
          issues: [],
        }));

        // removed issues - filter out those that were subsequently added back
        const removedIssues = removeEvents.filter((ev, i, array) => {
          if (ev.event.toString() === 'removed_from_project' && ev.project_id === projectId) {
            for (let subsequent = i + 1; subsequent < array.length; subsequent += 1) {
              if (array[subsequent].issue_number.toString() === ev.issue_number.toString() && array[subsequent].event === 'added_to_project') {
                return false; // ignore removals that were added back
              }
            }
            return true; // keep removals not re-added
          }
          return false; // ignore adds
        });

        // iterate columns
        for (let col = 0; col < columns.data.length; col += 1) {
          // get cards for column
          const cards = await octokit.request(
            'GET /projects/columns/:column_id/cards',
            {
              owner,
              repo,
              column_id: columns.data[col].id,
            },
          );

          // iterate cards
          const keys = Object.keys(cards.data);
          keys.forEach(async (columnCard) => {
            // get card details
            const card = await octokit.request(
              'GET /projects/columns/cards/:card_id',
              {
                owner,
                repo,
                card_id: cards.data[columnCard].id,
              },
            );

            // TODO: notes (currently ignored)
            if (typeof card.data.content_url === 'string') {
              // determine issue number
              const contentUrlParts = card.data.content_url.split(
                '/',
              );
              const issueNumber = contentUrlParts[contentUrlParts.length - 1];

              // GET REPO EVENTS
              const issueEvents = await octokit.request(
                'GET /repos/:owner/:repo/issues/:issue_number/events',
                {
                  owner,
                  repo,
                  issue_number: issueNumber,
                },
              );

              const eventsSummary = issueEvents.data.map(
                (ev) => {
                  const timeDiff = new Date(ev.created_at).getTime()
                    - new Date().getTime();
                  const dayDiff = Math.round(
                    timeDiff / (1000 * 3600 * 24),
                  );
                  return {
                    event: ev.event,
                    daysAgo: dayDiff,
                    project_card: ev.project_card,
                    time_diff: timeDiff,
                  };
                },
              );

              // sort by time
              eventsSummary.sort((a, b) => (a.time_diff > b.time_diff ? 1 : -1));

              // filter on time period
              const relevantEvents = [];

              let issueGroup = 0;
              // 0 - no change
              // 1 - moved_columns_in_project
              // 2 - added_to_project, converted_note_to_issue
              // 3 - reopened
              // 4 - closed
              // 5 - removed_from_project (TODO)

              for (let e = 0; e < eventsSummary.length; e += 1) {
                // filter out events outside time range
                if (
                  Math.abs(eventsSummary[e].daysAgo)
                  <= daysToQuery
                  && eventsSummary[e].daysAgo <= 0
                ) {
                  relevantEvents.push(eventsSummary[e]);

                  // most relevant change determines grouping
                  if (eventsSummary[e].event
                    === 'moved_columns_in_project' && issueGroup === 0) {
                    issueGroup = 1;
                  }
                  if (eventsSummary[e].event === 'added_to_project' || eventsSummary[e].event === 'converted_note_to_issue') {
                    issueGroup = 2;
                  }
                  if (eventsSummary[e].event === 'reopened') {
                    issueGroup = 3;
                  }
                  if (eventsSummary[e].event === 'closed') {
                    issueGroup = 4;
                  }
                }
              }

              // describe flow between now and days ago
              const flow = relevantEvents
                .map((ev, i) => (ev.project_card
                  && ev.project_card.column_name
                  ? (i === 0
                    && ev.project_card.previous_column_name
                    ? `${ev.project_card
                      .previous_column_name
                    } -> `
                    : '')
                  + ev.project_card.column_name
                  : ev.event))
                .join(' -> ');

              // get issue details (for title and html url)
              const issue = await octokit.request(
                'GET /repos/:owner/:repo/issues/:issue_number',
                {
                  owner,
                  repo,
                  issue_number: issueNumber,
                },
              );

              const issueComments = await octokit.request(
                '/repos/:owner/:repo/issues/:issue_number/comments',
                {
                  owner,
                  repo,
                  issue_number: issueNumber,
                },
              );

              const totalComments = issueComments.data.length;
              const periodComments = issueComments.data.filter(
                (comment) => {
                  const timeDiff = new Date(comment.created_at).getTime() - new Date().getTime();
                  const dayDiff = Math.round(timeDiff / (1000 * 3600 * 24));
                  return (Math.abs(dayDiff) <= daysToQuery);
                },
              ).length;

              // store card for email content
              kanbanColumns[col].issues.push({
                id: issueNumber,
                html_url: issue.data.html_url,
                title: issue.data.title,
                group: issueGroup,
                flow,
                totalComments,
                periodComments,
              });
            } else {
              console.log('ignoring note');
            }
          });
          // sort by group (0-unchanged, 1-moved, 2-added)
          kanbanColumns[col].issues.sort((a, b) => (a.group > b.group ? 1 : -1));
        }

        projectKanbans.push({
          name: repoProjects.data[p].name,
          url: repoProjects.data[p].html_url,
          columns: kanbanColumns,
          days: daysToQuery,
          removed: removedIssues,
        });
      }
    }

    const htmlReport = HTMLReporter.write(projectKanbans);

    // save snapshot as artifact for action run
    const path = 'kanban/index.html';
    await makeDir(dirname(path));
    appendFileSync(path, htmlReport);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
