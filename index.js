const core = require("@actions/core");
const { Octokit } = require("@octokit/rest");
const nodemailer = require("nodemailer");
const { dirname } = require("path");
const { appendFileSync } = require("fs");
const makeDir = require("make-dir");

async function run() {
    try {
        const token = core.getInput("token");
        // email inputs
        const smtpServer = core.getInput("smtp-server");
        const smtpServerPort = core.getInput("smtp-server-port");
        const authUser = core.getInput("auth-user"); // secret
        const authPwd = core.getInput("auth-pwd"); // secret
        const emailFrom = core.getInput("email-from");
        const recipientEmails = core.getInput("recipient-emails"); // secret
        // scope of data
        const projectNumbers = core.getInput("project-numbers"); // secret
        // const phaseEndDate = core.getInput("phase-end-date"); //
        const phaseCalendarDays = core.getInput("days"); //

        let projectsToQuery = [];

        if (projectNumbers.toLowerCase() !== "all") {
            try {
                projectsToQuery = projectNumbers.split(",");
            } catch (error) {
                // invalid project number list
            }
        }

        let daysToQuery = 7;
        if (!isNaN(phaseCalendarDays)) {
            daysToQuery = parseInt(phaseCalendarDays);
        }

        const octokit = new Octokit({
            auth: token,
            previews: ["starfox-preview", "inertia-preview"],
        });
        const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

        // get open projects in repo
        const repo_projects = await octokit.request(
            "GET /repos/:owner/:repo/projects",
            {
                owner,
                repo,
            }
        );

        // get repo issues updated in last 30 days
        const since = new Date(new Date().getTime() - (30 * 1000 * 3600 * 24));
        const issues_since = await octokit.request(
            'GET /repos/{owner}/{repo}/issues',
            {
                owner,
                repo,
                since: since
            });

        // for issues updated in last 30 days, get removals and additions to projects
        const remove_events = [];
        for (let i = 0; i < issues_since.data.length; i++) {

            const update_issue_events = await octokit.request(
                "GET /repos/{owner}/{repo}/issues/:issue_number/events",
                {
                    owner,
                    repo,
                    issue_number: issues_since.data[i].number,
                }
            );

            const removals = update_issue_events.data.filter(
                (ev) => {
                    return (
                        (ev.event === "removed_from_project" || ev.event === "added_to_project")
                    )
                }
            );

            // sort date ascending
            removals.sort((a, b) =>
                a.created_at > b.created_at ? 1 : -1
            );

            // save relevant events for issue
            for (const remove_ev in removals) {
                remove_events.push(
                    {
                        "issue_number": issues_since.data[i].number,
                        "event": removals[remove_ev].event,
                        "created_at": removals[remove_ev].created_at,
                        "html_url": issues_since.data[i].html_url,
                        "title": issues_since.data[i].title,
                        "project_id": removals[remove_ev].project_card.project_id
                    }
                );
            }

        }

        // iterate projects in repo
        const projectKanbans = [];
        for (let p = 0; p < repo_projects.data.length; p++) {
            if (
                projectsToQuery.length === 0 ||
                projectsToQuery.toLowerCase() === "all" ||
                projectsToQuery.indexOf(
                    repo_projects.data[p].number.toString()
                ) > -1
            ) {
                // get columns for project
                const project_id = repo_projects.data[p].id;
                const columns = await octokit.request(
                    "GET /projects/:project_id/columns",
                    {
                        owner,
                        repo,
                        project_id: repo_projects.data[p].id,
                    }
                );

                // info for summary
                const kanbanColumns = columns.data.map(function (element) {
                    return {
                        name: element.name,
                        issues: [],
                    };
                });

                // removed issues - filter out those that were subsequently added back
                const removed_issues = remove_events.filter((ev, i, array) => {
                    if (ev.event.toString() === 'removed_from_project' && ev.project_id === project_id) {
                        for (let subsequent = i + 1; subsequent < array.length; subsequent++) {
                            if (array[subsequent].issue_number.toString() === ev.issue_number.toString() && array[subsequent].event === "added_to_project") {
                                return false; // ignore removals that were added back
                            }
                        }
                        return true; // keep removals not re-added
                    } else {
                        return false; // ignore adds
                    }
                });

                // iterate columns
                for (let col = 0; col < columns.data.length; col++) {
                    // get cards for column
                    const cards = await octokit.request(
                        "GET /projects/columns/:column_id/cards",
                        {
                            owner,
                            repo,
                            column_id: columns.data[col].id,
                        }
                    );

                    // iterate cards
                    for (const columnCard in cards.data) {
                        // get card details
                        const card = await octokit.request(
                            "GET /projects/columns/cards/:card_id",
                            {
                                owner,
                                repo,
                                card_id: cards.data[columnCard].id,
                            }
                        );

                        // TODO: notes (currently ignored)
                        if (typeof card.data.content_url === "string") {
                            // determine issue number
                            const contentUrlParts = card.data.content_url.split(
                                "/"
                            );
                            const issue_number =
                                contentUrlParts[contentUrlParts.length - 1];

                            // GET REPO EVENTS
                            const issue_events = await octokit.request(
                                "GET /repos/:owner/:repo/issues/:issue_number/events",
                                {
                                    owner,
                                    repo,
                                    issue_number,
                                }
                            );

                            const events_summary = issue_events.data.map(
                                (ev) => {
                                    const Difference_In_Time =
                                        new Date(ev.created_at).getTime() -
                                        new Date().getTime();
                                    const Difference_In_Days = Math.round(
                                        Difference_In_Time / (1000 * 3600 * 24)
                                    );
                                    return {
                                        event: ev.event,
                                        days_ago: Difference_In_Days,
                                        project_card: ev.project_card,
                                        time_diff: Difference_In_Time,
                                    };
                                }
                            );

                            // sort by time
                            events_summary.sort((a, b) =>
                                a.time_diff > b.time_diff ? 1 : -1
                            );

                            // filter on time period
                            const relevant_events = [];

                            let issueGroup = 0;
                            // 0 - no change
                            // 1 - moved_columns_in_project
                            // 2 - added_to_project, converted_note_to_issue
                            // 3 - reopened
                            // 4 - closed
                            // 5 - removed_from_project (TODO)

                            for (let e = 0; e < events_summary.length; e++) {
                                // filter out events outside time range
                                if (
                                    Math.abs(events_summary[e].days_ago) <=
                                    daysToQuery &&
                                    events_summary[e].days_ago <= 0
                                ) {
                                    relevant_events.push(events_summary[e]);

                                    // most relevant change determines grouping
                                    if (events_summary[e].event ===
                                        "moved_columns_in_project" && issueGroup === 0) {
                                        issueGroup = 1;
                                    }
                                    if (events_summary[e].event === "added_to_project" || events_summary[e].event === "converted_note_to_issue") {
                                        issueGroup = 2;
                                    }
                                    if (events_summary[e].event === "reopened") {
                                        issueGroup = 3;
                                    }
                                    if (events_summary[e].event === "closed") {
                                        issueGroup = 4;
                                    }
                                }
                            }

                            // describe flow between now and days ago
                            const flow = relevant_events
                                .map((ev, i) => {
                                    return ev.project_card &&
                                        ev.project_card.column_name
                                        ? (i == 0 &&
                                            ev.project_card.previous_column_name
                                            ? ev.project_card
                                                .previous_column_name +
                                            " -> "
                                            : "") +
                                        ev.project_card.column_name
                                        : ev.event;
                                })
                                .join(" -> ");

                            // get issue details (for title and html url)
                            const issue = await octokit.request(
                                "GET /repos/:owner/:repo/issues/:issue_number",
                                {
                                    owner,
                                    repo,
                                    issue_number,
                                }
                            );

                            const issue_comments = await octokit.request(
                                "/repos/:owner/:repo/issues/:issue_number/comments",
                                {
                                    owner,
                                    repo,
                                    issue_number,
                                }
                            );

                            const total_comments = issue_comments.data.length;
                            const period_comments = issue_comments.data.filter(
                                function (comment) {
                                    const Difference_In_Time =
                                        new Date(comment.created_at).getTime() -
                                        new Date().getTime();
                                    const Difference_In_Days = Math.round(
                                        Difference_In_Time / (1000 * 3600 * 24)
                                    );
                                    return (
                                        Math.abs(Difference_In_Days) <=
                                        daysToQuery
                                    );
                                }
                            ).length;

                            // store card for email content
                            kanbanColumns[col].issues.push({
                                id: issue_number,
                                html_url: issue.data.html_url,
                                title: issue.data.title,
                                group: issueGroup,
                                flow: flow,
                                total_comments: total_comments,
                                period_comments: period_comments,
                            });
                        } else {
                            console.log("ignoring note");
                        }
                    }
                    // sort by group (0-unchanged, 1-moved, 2-added)
                    kanbanColumns[col].issues.sort((a, b) =>
                        a.group > b.group ? 1 : -1
                    );
                }

                projectKanbans.push(
                    drawKanban(
                        repo_projects.data[p].name,
                        repo_projects.data[p].html_url,
                        kanbanColumns,
                        daysToQuery,
                        removed_issues
                    )
                );

            }
        }

        // TODO: can CSS be input?
        const cssStyle =
            "<head><style>" +
            " ul {padding: 12px;} ul li {list-style-type: circle;}" +
            " .removed {align: center; width: 100%; padding: 4px; vertical-align: top; text-align:left;} " +
            " .project {overflow-x:auto; text-align: center; } " +
            " .projectname {font-size:large; font-weight: bold; } " +
            " a.comments {color:purple; font-style: italic; font-size: small; font-weight: bold;} " +
            " .grouphead  {font-style: italic; text-align: center; }" +
            " .grouping0  {background-color: #f0efef;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping1  {background-color: #ddeedd;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping2  {background-color: #c2d4dd;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping3  {background-color: #eaece5;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping4  {background-color: #b2c2bf;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping5  {background-color: #f0efef;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" + " .column { font-weight: bold; text-align: center;    }" +
            " table { width: 100%; padding: 4px; border-spacing: 4px;}" +
            " td {background-color: #f0efef; width:150px; padding: 8px; vertical-align: top; text-align:left; border: 1px solid #cccccc;  border-radius: 6px;} " +
            " </style></head>";

        // save snapshot as artifact for action run
        const path = "kanban/index.html";
        await makeDir(dirname(path));
        appendFileSync(
            path,
            "<html>" +
            cssStyle +
            "<body>" +
            projectKanbans.join("") +
            "</body></html>"
        );

        // email kanbans
        // TODO: validate recipients and other email input
        if (recipientEmails.indexOf("@") > -1) {
            let subject =
                "Project activity " +
                owner +
                "/" +
                repo +
                " - past " +
                daysToQuery +
                " days";
            let isTLS = false;
            const transport = nodemailer.createTransport({
                host: smtpServer,
                port: smtpServerPort,
                secure: isTLS,
                auth: {
                    user: authUser,
                    pass: authPwd,
                },
            });
            await transport.sendMail({
                from: get_from(emailFrom, authUser),
                to: recipientEmails,
                subject: subject,
                html: cssStyle + projectKanbans.join(""),
            });
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

function get_from(from, username) {
    if (from.match(/.+<.+@.+>/)) {
        return from;
    }
    return `"${from}" <${username}>`;
}

function drawKanban(projectName, projectUrl, columns, days_ago, removedIssues) {
    const today = new Date();
    const groups = ["No change", "Moved here", "Added", "Reopened", "Closed", "Removed"];
    return (
        '<br/><div class="project"><span class="projectname"><a href="' + projectUrl + '">' +
        projectName +
        "</a></span><br/>" +
        " past " +
        days_ago +
        " days activity (as at " +
        today.getDate() +
        "/" +
        (today.getMonth() + 1) +
        "/" +
        today.getFullYear() +
        ")" +
        (removedIssues.length > 0 ? '<div class="removed"><span class="grouphead">Removed issues</span><br/>' +
            removedIssues.map((issue) => {
                return (
                    '<a title="" href="' + issue.html_url + '" class="group0">' +
                    issue.title +
                    "</a> "
                );
            }).join("") + '</div>'
            : '') +
        "<table><tr>" +
        columns
            .map(function (element) {
                return (
                    '<td><div class="column">' +
                    element.name +
                    "</div>" +
                    (element.issues.length === 0
                        ? '<div style="text-align:center;">No issues</div>'
                        : element.issues
                            .map((issue, i, arr) => {
                                return (
                                    (i > 0 && arr[i - 1].group !== issue.group
                                        ? "</div>"
                                        : "") +
                                    (i === 0 ||
                                        arr[i - 1].group !== issue.group
                                        ? '<br/><div class="grouping' +
                                        issue.group +
                                        '"><div class="grouphead">' +
                                        groups[issue.group] +
                                        "</div>"
                                        : "") +
                                    '<li><a title="' +
                                    issue.flow +
                                    '" href="' +
                                    issue.html_url +
                                    '" class="group' +
                                    issue.group +
                                    '">' +
                                    issue.title +
                                    "</a> " +
                                    (issue.period_comments > 0
                                        ? ' <a class="comments" title="' +
                                        issue.period_comments +
                                        " of " +
                                        issue.total_comments +
                                        '" href="' +
                                        issue.html_url +
                                        '">new comments</a>'
                                        : "") +
                                    "</li>" +
                                    (i === arr.length - 1 ? "</div>" : "")
                                );
                            })
                            .join("")) +
                    "</td>"
                );
            })
            .join("") +
        "</tr></table>" +
        "</div><br/>"
    );
}

run();
