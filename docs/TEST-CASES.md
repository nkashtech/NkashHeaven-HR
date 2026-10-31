# NkashHeaven-HR test cases

Manual test cases for the whole system. The automated suite (`cd backend && npm test`) covers the same rules at API level; these confirm them on screen.

**App:** http://localhost:3010

To reset the data before a test run, in `backend/`:

```bash
npm run db:seed
```

Seeding wipes everything and logs everybody out. Use it on your test machine only, never on your live server.

## Test credentials

All accounts use the password `Nkash@Demo2026!`. They exist only in the seeded demo data.

| Who | Email | Sign in at | Use it for |
|---|---|---|---|
| Super Admin | superadmin@nkashheaven.co.za | /login, leave Company code empty | Companies, system health, integrations |

**NkashHeaven** (company link `/c/nkashheaven`, orange theme)

| Role | Email | Use it for |
|---|---|---|
| Company Admin | naledi@nkashheaven.co.za | Employees, roles, workflows, settings, payroll, kiosk |
| Manager | lerato@nkashheaven.co.za | Final approvals, projects, appraisals |
| Manager | ayanda@nkashheaven.co.za | Thabo's manager: first leave approval, timesheets |
| Employee | thabo@nkashheaven.co.za | Check-in, timesheets, leave, payslips, card |
| HR | kea@nkashheaven.co.za | HR without role management (after reseeding) |
| Unpaid intern | lwazi@nkashheaven.co.za | Employee with payslips switched off for them only |
| Employee | johan@nkashheaven.co.za | Being tagged, chat, birthdays |

**Bluewave Logistics** (company link `/c/bluewave`, blue theme)

| Role | Email | Use it for |
|---|---|---|
| Company Admin | amahle@bluewave.co.za | A second company, to prove the two are separate |
| Manager | peter@bluewave.co.za | |
| Employee | sarah@bluewave.co.za | |

On a test machine, real email only goes to addresses listed in `EMAIL_TEST_ALLOW` in `backend/.env`. Everything else, including a new employee's temporary password, prints in the backend console. Look for `[email:dev]`.

Use two different browsers (or a private window) when a test needs two people signed in at once.

## How to record results

Mark each case Pass, Fail or Blocked, and note the date and tester. Log a failure with the case ID, the account used and a screenshot.

## 1. Companies and separation

| ID | Account | Steps | Expected result |
|---|---|---|---|
| CO-1 | Super Admin | Companies → New company. Enter a name, logo, admin name and a test email | Company listed with its own link. The admin gets a welcome email showing that company's name and logo |
| CO-1a | Super Admin | Create another company with no logo | It uses the NkashHeaven logo with its own name. The admin can change both under Theme & branding |
| CO-2 | New admin | Open the company link, sign in with the temporary password | Forced to choose a password. If 2FA is required, asked to set it up. Then lands in an empty company with starter roles and leave types |
| CO-3 | Any | Open /c/bluewave/login | Shows Bluewave's name and blue colour, not NkashHeaven's |
| CO-4 | Sarah | Sign in at /c/nkashheaven/login with her Bluewave details | Refused. Her account does not exist in that company |
| CO-5 | Thabo | Sign in at /login with Company code `bluewave` | Refused |
| CO-6 | Amahle | Open Employees, People, Chat, Projects, Reports | Only Bluewave people and data appear |
| CO-7 | Naledi | Open /people/ followed by the number of a Bluewave person | Not found. Nothing from Bluewave shows |
| CO-8 | Super Admin | Companies → open Bluewave → Suspend company, then try signing in as Sarah | Refused until you Reactivate |
| CO-9 | Super Admin | Companies → open a company, turn a feature off (e.g. Chat) | The menu item disappears for that company only |
| CO-10 | Super Admin | Reach the seat limit, then add an employee as that company's admin | Refused with a seat limit message |

## 2. Roles and access

There are no fixed roles. Company Admin, Manager and Employee are starter roles that each company can change or delete.

| ID | Account | Steps | Expected result |
|---|---|---|---|
| ROL-1 | Naledi | Roles → New role "Payroll Clerk". Set Can see data of to The whole company. Tick the Payroll screen permissions only. Save | Role listed |
| ROL-2 | Naledi | Employees → edit Johan → Role: Payroll Clerk | Saved |
| ROL-3 | Johan | Refresh | Payroll appears in the menu. Screens not ticked are gone, and typing their address goes back to the dashboard |
| ROL-4 | Naledi | Remove a screen from Employee (e.g. Calendar) | Calendar disappears for employees within seconds |
| ROL-5 | Naledi | Try unticking Create roles on Company Admin | Locked: the owner role always keeps them |
| ROL-6 | Naledi | Delete a role that still has people on it | Refused until they are moved |
| ROL-7 | Lerato | Give yourself a permission you lack, by any route | No Roles screen. The API returns 403 |
| ROL-8 | Naledi | Log in and look at the menu | No Timesheets: admins do not log timesheets. Ticking Log timesheets on a role turns it on |
| ROL-9 | Thabo | Type /hr/employees, /hr/payroll, /system into the address bar | Redirected to the dashboard |

## 3. Departments, teams and workflows

| ID | Account | Steps | Expected result |
|---|---|---|---|
| ORG-1 | Naledi | Company Settings → Organisation. Add a department and a team with a lead | Both listed and available on the employee form |
| ORG-2 | Naledi | Workflows → New workflow "Leave: HR only" for leave, with one step: a specific person (Naledi). Save | Listed |
| ORG-3 | Naledi | Leave tab → set a leave type to use that workflow | Saved |
| ORG-4 | Thabo, Naledi | Thabo requests that leave type | It goes straight to Naledi, not Ayanda. One approval finishes it |
| ORG-5 | Naledi | New workflow for timesheets with steps Manager, then a role. Select it under Workflow for weekly timesheets | Thabo's next week follows those steps |
| ORG-5a | Naledi, Johan, Thabo | Employees → edit Thabo → Manager: Johan (an ordinary Employee). Thabo requests leave, then sign in as Johan | Johan now has Approvals in his menu and can approve Thabo's request. His role did not change |
| ORG-5b | Naledi, Johan | Change Thabo's manager back to Ayanda, then refresh as Johan | Approvals is gone from Johan's menu |
| ORG-6 | Naledi | Delete a workflow in use | It is removed. Leave types that used it go back to the default steps |

## 4. Employee records

| ID | Account | Steps | Expected result |
|---|---|---|---|
| EMP-1 | Naledi | Employees → Add employee. Fill in only Employment, then Create & send invite | Created. The other tabs are optional |
| EMP-2 | Naledi | Add employee, filling in Personal information, Contact information, Emergency contact, Bank account, Dependents, Work experience, Qualifications and Memberships | All saved. Reopening the employee shows every value |
| EMP-3 | Naledi | Reopen that employee | Government ID and bank numbers show masked |
| EMP-4 | New user | Open the link from the email | Page says "Welcome, [name]", email is filled in, the field says Temporary password |
| EMP-5 | New user | Enter the temporary password | Forced to Choose your password. No other screen is reachable |
| EMP-6 | New user | Try a weak password, then the temporary one again | Checklist stays incomplete, or the server refuses it |
| EMP-7 | New user | Set a valid password. Only a company admin then sees the setup steps | Lands on the dashboard. The admin gets an "activated" notification |
| EMP-8 | Any | Open the company sign-in page directly | Says "Sign in", no mention of a temporary password |
| EMP-9 | Naledi | Resend an invite, then try the old temporary password | Old password is rejected |
| EMP-10 | Any | Enter a wrong password 5 times | Account locks for 15 minutes |
| EMP-11 | Any | Open the same invite link after activating | Says the invite was already used |
| EMP-12 | Thabo | My Profile → work through each section. Change a mobile number | Saved at once. HR notified with old and new values |
| EMP-13 | Thabo | Change bank details | Old details stay until Change Requests approves them |
| EMP-14 | Thabo | My Profile → Documents: upload a file. eSignature: upload an image | Both saved. A colleague cannot open the document |
| EMP-15 | Thabo | My Profile → Change photo | Photo shows in the sidebar, directory, profile and card |
| EMP-16 | Any | People → click a name | Shows their position under the name, their manager, team, department, who they work with, and projects |
| EMP-17 | Thabo | Hide birthday in Settings | Removed from Celebrations and Calendar |

## 5. Attendance

| ID | Account | Steps | Expected result |
|---|---|---|---|
| ATT-1 | Thabo | Click Check In | Timer starts at 00:00:00. Button changes to Check Out |
| ATT-1a | Naledi | Look at the top bar and the menu | Check In is there, and so is Timesheets |
| ROL-HR1 | Kea | Employees → New employee → Role | HR and Company Admin aren't offered. Only managers and employees |
| ROL-HR2 | Kea | Open Naledi under Employees | No Edit, Archive or Access. A note says only the company admin can change it |
| ROL-HR3 | Kea, Thabo | Thabo → Access → My Payslips: Off → Save. Sign in as Thabo | My Payslips is gone from his menu. Other employees still have it |
| ROL-HR4 | Naledi | Roles → Company Admin → rename to HR Director | The sidebar badge shows HD; the role works as before |
| ROL-HR5 | Naledi | Roles → Company Admin → rename to HR while the HR role still has that name | Refused: role names are unique. Rename the HR role first, then the rename works and she keeps every owner power |
| BR-LOGO | Naledi | Theme & branding → change the logo → Save | Sidebar, browser tab icon and employee cards show the new logo |
| ATT-2 | Thabo | Reload the page, then open it in another browser | Timer continues from the same time on both |
| ATT-3 | Thabo | Click Check Out | Timer stops. A row appears in My Attendance with worked hours |
| ATT-4 | Thabo | Open Attendance | No New button. Absent days say only HR can add a missed day |
| ATT-5 | Thabo | Edit a past record: change the check-out, give a reason | Row shows Edited. Edit history shows old and new values |
| ATT-6 | Thabo | Edit a record so check-out is before check-in | Error, nothing saved |
| ATT-7 | Thabo | Click Ask HR to add on an absent day | Admin sees it under Approvals |
| ATT-8 | Naledi | Add record for that day with a reason | Record created, employee notified |
| ATT-9 | Naledi | Set the lock date to today, then try editing as Thabo | Refused with "Period locked" |

## 6. Employee cards and scanning

| ID | Account | Steps | Expected result |
|---|---|---|---|
| CRD-1 | Thabo | My Card | Card shows name, job, department, number and QR. Print opens the browser's print window |
| CRD-2 | Naledi | Company Settings → Employee cards. Change width, height, colours, title. Upload a logo and a background image. Save card design | Preview updates. Thabo's card matches after a refresh |
| CRD-3 | Naledi | Choose a preset size | Width and height change |
| CRD-4 | Naledi | Untick Department and Employee number | Both disappear from the card |
| CRD-5 | Naledi | Card Kiosk. Point the camera at Thabo's QR (needs https, or localhost) | "Welcome, Thabo", checked in. His timer starts on his own screen without a refresh |
| CRD-6 | Naledi | Scan the same card again straight away | "Already scanned, Thabo". No second record |
| CRD-7 | Naledi | Scan it again after a minute | "Goodbye", checked out |
| CRD-8 | Naledi | With a USB scanner, or by typing the card code into the box under the camera | Same as CRD-5 |
| CRD-9 | Naledi | Scan a Bluewave card at the NkashHeaven kiosk | "This card is not valid here" |
| CRD-10 | Any phone | Scan the QR with a normal phone camera | Opens a public page with the name and job only. No private details |
| CRD-11 | Naledi | Employees → open Thabo's card → Reissue card, then scan the old one | Old card refused |

## 7. Timesheets

| ID | Account | Steps | Expected result |
|---|---|---|---|
| TS-1 | Thabo | Open Timesheets, click Add a line, pick a project | Row appears for the week. A task is optional |
| TS-2 | Thabo | Type 3:30 in a cell and click away | Saved. Row and column totals update |
| TS-3 | Thabo | Switch to Entries, New entry. In Worked with, type "joh" | Johan van Wyk drops down. Arrow keys and Enter choose him |
| TS-4 | Thabo | Finish the entry and save | Entry listed. Grid cell shows the total |
| TS-5 | Johan | Open the bell | In-app notification: Thabo tagged you |
| TS-6 | Thabo | New entry → Project → + Create a new project | Project is created and selected. It also appears under Projects |
| TS-7 | Thabo | Click START, pick a project, then Stop | Time rounds up to 15 minutes and lands on today |
| TS-8 | Thabo | Press the row's letter (a), then press it again | Timer starts, then stops |
| TS-9 | Thabo | Press Shift + the row's letter | 15 minutes are added to today |
| TS-10 | Thabo | Type 25 in a cell | Refused: a day cannot pass 24 hours |
| TS-11 | Ayanda | Validate last week under Approvals | Week locks for Thabo with a lock icon |
| TS-12 | Ayanda | Approvals → Validated and approved → Reset | Week opens again for Thabo |
| TS-13 | Thabo | In Worked with, search for a Bluewave name | Nobody by that name |

## 8. Leave and holidays

| ID | Account | Steps | Expected result |
|---|---|---|---|
| LV-1 | Naledi | Company Settings → Holidays. Add an Office closure | Listed with an Office label, shows on the Calendar |
| LV-2 | Thabo | Request leave over that date | Duration leaves that day out |
| LV-3 | Thabo | Request more days than available | Submit disabled, reason shown |
| LV-4 | Thabo, Ayanda, Naledi | Submit annual leave, Ayanda (manager) approves, then Naledi (HR) approves | Thabo sees Submitted → Manager → HR fill in. Bot message confirms |
| LV-4a | Thabo, Naledi | Submit family responsibility leave (set to Straight to HR) | It skips Ayanda and goes to Naledi. One approval finishes it |
| LV-4b | Naledi | Leave tab → edit a leave type → Approval flow | Options are Manager then HR, Straight to HR, Manager only, No approval |
| LV-5 | Ayanda | Refuse a request | A reason is required and Thabo sees it |
| LV-6 | Thabo | Cancel a request before its first day | Balance is restored |
| LV-7 | Lerato | Reset approved leave from Validated and approved | Back to draft, balance restored |
| LV-8 | Thabo | In December, book January leave | Uses the projected allocation, not 0 |
| LV-9 | Thabo | Download the leave statement PDF | Totals match the balance card |

## 9. Theme, dark mode and email design

| ID | Account | Steps | Expected result |
|---|---|---|---|
| THM-1 | Naledi | Company Settings → Theme & branding. Set the brand colour to blue. Save | Orange is replaced by blue across the app for everyone in the company, including the sign-in page |
| THM-2 | Amahle | Look at the app at the same moment | Bluewave's own colour is unchanged |
| THM-3 | Any | Click the moon icon at the top | Whole app turns dark. Reload keeps it. The brand colour still reads clearly |
| THM-4 | Naledi | Theme & branding: change the Company name, upload a logo and a separate payslip logo | Sidebar, sign-in page, browser tab, card and emails show the new name and logo without a reload. Payslips print the payslip logo |
| EML-1 | Naledi | Company Settings → Email templates. Change the Subject, Heading and Text of Welcome email. Save and preview | Preview shows the new wording |
| EML-2 | Naledi | Change Button, Background, Panel and Text colours, change the Button text, upload a Header image | Preview updates after saving |
| EML-3 | Naledi | Invite a new employee | The email uses your wording, colours and image. The sign-in details are still present |
| EML-4 | Naledi | Repeat for Password reset, Notification and Payslip ready | Each uses its own design |
| EML-5 | Naledi | Reset to default | Original wording returns |
| EML-6 | Amahle | Open Email templates | NkashHeaven's edits do not appear |

## 10. Projects

| ID | Account | Steps | Expected result |
|---|---|---|---|
| PRJ-1 | Lerato | Projects → New | Project created on the first stage, with To Do, In Progress, Review and Done |
| PRJ-2 | Lerato | Drag a card to another stage | Stage changes and is recorded in the chatter |
| PRJ-3 | Any | Star a project, then filter Favourites | Only starred projects show |
| PRJ-4 | Lerato | Open a project. Set manager, dates, allocated time, tags, description. Save | Saved. Card shows hours remaining |
| PRJ-5 | Thabo | Log more hours than allocated | Card shows a red negative balance |
| PRJ-6 | Lerato | Open Tasks, add a task, assign Thabo | Thabo gets an in-app notification |
| PRJ-7 | Thabo | Drag the task to Done | Tasks button shows the higher count and percentage |
| PRJ-8 | Any | Open a task. Add a sub-task, deadline, description | Saved |
| PRJ-9 | Any | Send message, Log note, schedule an Activity | Followers are notified for messages only. Activity shows until marked done |
| PRJ-10 | Any | Register tab: add a Risk, an Issue and a Change | Listed there and under Risk & Issue Register |
| PRJ-11 | Thabo | Try to edit a project he doesn't manage | Fields are read-only and the API refuses |
| PRJ-12 | Any | Dashboard and Reporting | Figures match the projects and logged time |

## 11. ClickUp import

| ID | Account | Steps | Expected result |
|---|---|---|---|
| CU-1 | Lerato | Projects → Import from ClickUp. Paste a personal token | Lists from your workspace appear. A bad token is refused |
| CU-2 | Lerato | Tick a list, Import | Project appears with stages from ClickUp statuses, plus tasks, deadlines and sub-tasks. Assignees match by email; others are listed |
| CU-3 | Lerato | Import the same list again | Tasks update, nothing duplicates |
| CU-4 | Lerato | Upload a CSV export from ClickUp | Project is created from the file |

## 12. Contracts

| ID | Account | Steps | Expected result |
|---|---|---|---|
| CON-1 | Naledi | Contracts → New, then Start | Status Running. A previous running contract expires |
| CON-2 | Naledi | Add probation end and work permit expiry | Warnings show on the list. The dashboard compliance count includes them |
| CON-3 | Lerato | Open /hr/contracts | Redirected to the dashboard. API returns 403 |
| CON-4 | Naledi | Attach a signed contract | Employee's own contract file can be opened; a colleague's cannot |

## 13. Payroll

| ID | Account | Steps | Expected result |
|---|---|---|---|
| PAY-1 | Naledi | Payroll → pick a period → Generate payslips | One payslip per running contract |
| PAY-2 | Naledi | Open a payslip | Shows basic, allowances, PAYE, UIF, net and employer costs |
| PAY-3 | Naledi | Add a Bonus line, then Compute sheet | Bonus stays and net updates |
| PAY-4 | Naledi | Approve unpaid leave in the period, recompute | Unpaid days are deducted |
| PAY-5 | Naledi | Verify, then try adding a line | Refused: batch locked |
| PAY-6 | Thabo | Open My Payslips before publishing | Nothing shows |
| PAY-7 | Naledi | Publish to employees, then Mark as paid | Employees notified and emailed. Status Paid |
| PAY-8 | Thabo | My Payslips → Print | PDF with the company logo, earnings, deductions and net pay |
| PAY-9 | Naledi | Rules and tax: add a rule, change a tax value | Applies on the next compute |

**Check before real use:** have your accountant confirm the tax tables under Rules and tax, and compare a few payslips with your current payroll. They are editable and default to the 2025/26 SARS figures. PAYE is worked out on gross pay and does not yet take pension or medical aid relief into account.

## 14. Appraisals

| ID | Account | Steps | Expected result |
|---|---|---|---|
| APR-1 | Lerato | Appraisals → New, pick a team member | Employee and manager are notified. Form is pre-filled from the template |
| APR-2 | Thabo | Fill in feedback, Submit | Locked for Thabo, visible to the manager |
| APR-3 | Thabo | Look at the manager's column | Hidden until finished |
| APR-4 | Lerato | Rate and Finish appraisal | Status Done. Thabo sees the rating and feedback |
| APR-5 | Thabo | Add a goal, move its progress slider | Progress saved |
| APR-6 | Lerato | Reopen a finished appraisal | Back to Waiting for feedback |

## 15. Calendar, chat, settings

| ID | Account | Steps | Expected result |
|---|---|---|---|
| CAL-1 | Thabo | Connect Google Calendar (needs OAuth keys) | Meetings appear within 5 minutes |
| CAL-2 | Thabo | Settings → Calendar → Push approved leave | After approval, "Out of office" appears in Google or Outlook |
| CHT-1 | Thabo, Johan | Message each other in two browsers | Arrives without a refresh |
| CHT-2 | Thabo | Try to post in #announcements | Input disabled with an explanation |
| CHT-3 | Thabo | Turn on Chat email digest, then go offline while receiving messages | One summary email per hour, not one per message |
| SET-1 | Thabo | Change the date format to 2026-10-30 | Full dates change across the app |
| SET-2 | Thabo | Change the language to Français | Menus, buttons and headings switch. Text not yet in the table stays English |

## 16. Platform

| ID | Account | Steps | Expected result |
|---|---|---|---|
| SYS-1 | Super Admin | System Health | Shows server, database, email and job status |
| SYS-2 | Super Admin | System Settings → Maintenance mode on | Everyone else is shut out, in every company |
| SYS-3 | Super Admin | Companies → open a company → view as a user, with a reason | Read-only, banner shows, the person is told |
| SYS-4 | Super Admin | System Settings → Run backup now | Backup listed as OK |
| SYS-5 | Naledi | Audit Log | Shows who changed what, with before and after. Only NkashHeaven's entries |

## 17. Before your first real employee

| ID | Check | Expected result |
|---|---|---|
| LIVE-1 | Super Admin signs in on the live server and sets up 2FA | Works with an authenticator app |
| LIVE-2 | Send a real invite to your own email | Arrives in your inbox, not spam, and the link opens your live address |
| LIVE-3 | Open the Card Kiosk on the tablet or phone you will use | Camera opens. This needs https |
| LIVE-4 | Run a backup and copy the file off the server | File opens and holds your data |
| LIVE-5 | Restart the server | Uploaded photos and logos are still there, because they live in cloud storage |
| LIVE-6 | Run a payroll beside your current one | Net pay matches, or your accountant has signed off the differences |
