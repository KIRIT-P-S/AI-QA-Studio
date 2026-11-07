# Client presentation - AI QA Studio

## Before the meeting

On your current computer, double-click Start Client Demo.cmd in the project folder. Your existing AI configuration and saved projects stay available. For the client, give only the clean delivery ZIP and this guide; do not zip your working folder.

Check that the studio opens at http://127.0.0.1:3000/ and the shop opens at http://127.0.0.1:4180/. The shop resets to Bug enabled on each fresh startup. Use a fresh demo project so previous run results do not confuse the live presentation.

## Recommended live sequence

1. Double-click Load Demo Project.cmd. Show six PRD requirement groups and eight linked draft tests. Explain that this is the supplied executable test path; it needs no AI API call.
2. Review one test's actions and expected assertion. Connect, give AI control, select and approve all eight tests, then run them.
3. Show the browser execution and Results: seven passes and the intentional TC07 cart failure. Open evidence and compare expected count 1 with the actual count 0. Requirement coverage should be 83% for this plan.
4. Create the cart issue. Open the demo control page, choose Fixed and apply it. Mark the issue Fixed and re-run TC07. Show the successful re-test, Verified issue and eight current passes.
5. Show 100% requirement coverage. Review the evidence yourself, record QA validation, then developer sign-off. Disconnect to finalize the video, open its evidence link and export the report.
6. If you have configured Gemini and time remains, demonstrate the second path in a separate fresh project: upload Shop_QA_Demo_PRD.md with AI extraction, connect/discover, generate test drafts, review their requirement links and approve them. Generated case counts can differ from the supplied eight-case plan. Do not promise an identical plan on every AI call.

## What to tell the client

“You provide the application URL and PRD, or your existing tests. The studio turns these into reviewable executable tests, runs approved assertions in a controlled browser, keeps evidence, tracks defects and re-tests, and gates release review on current passing results and requirement coverage.”

“For this Windows delivery, extract the package, configure your own AI key once, and double-click Start. All programming runtimes and the test browser are included. Your work is stored locally. AI generation needs internet and provider quota.”

Avoid claiming perfect correctness across all websites or that a coverage percentage represents every possible test. Show the actual evidence and explain the scope of the approved assertions.

## End the presentation

Double-click Stop AI QA Studio.cmd. Back up web\data\studio if you want to keep the presentation results. Send the original clean delivery ZIP, not an app folder that now contains private AI settings, uploaded documents or browser evidence.
