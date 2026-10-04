# 024: Tidy Notebook, a paid cloud and a free self-hosted edition

Status: active

This design states how the product becomes two editions of one code base. The
owner hosts a paid cloud service with a subscription for each user. Any person
can host the same product for free, and it stays private to that person. The
design covers the name of the product, the landing site, the payments, the
production infrastructure, and the limits that keep each cost of the cloud
bounded. It closes every choice, so the plan can be built in order with no
question left.

[Design 015](015-several-accounts-on-one-installation.md) gave one installation
several accounts, and [design 016](016-a-public-service.md) made one
installation safe for strangers. Design 016 named the account quota as "the
point where a plan would attach". This design attaches the plan there.

## The problem

The product is a self-hosted application today. One person runs it for
themselves and for the people they invite. The owner now wants three more
things.

1. **A landing site.** It describes the product, lists the plans and what each
   plan gives, and leads a visitor to a subscription.
2. **Payments.** A person subscribes to a plan, in US dollars, for each user.
   The owner must spend as little time on it as possible: no tax filing in each
   country, no invoice by hand, no failed payment to chase.
3. **Production infrastructure.** The cloud must scale and stay up. The
   subscription decides who has access, and every resource that costs the
   owner money has a limit, so no account and no stranger can make the bill
   grow without bound.

The cloud has no free plan. The self-hosted edition has every feature, costs
nothing, sends nothing to the owner, and becomes open source.

## What the code already does

Each fact below was read in the source at the time of this design.

**Strangers can already sign up.** Record 0108 gives one registration path, and
the `open` policy of record 0114 verifies the address before the first session.
Record 0115 adds a proof of work, record 0116 the password rule, and record
0120 the consent to the legal documents. The cloud turns on the `open` policy
and needs no new sign-up path.

**The account already holds a byte limit.** `accounts.limit_bytes` is checked
by `notesapp_add_usage` in the database, over the usage of every workspace that
the account owns (record 0112). The default comes from
`NOTESAPP_ACCOUNT_LIMIT_BYTES`, and an administrator can change it for one
account. The limit counts the text of each revision, a fixed overhead for each
revision and receipt, and the bytes of each attachment. A deletion keeps a
small reserve so it works on a full account.

**A refused save waits.** `packages/sync/src/queue.ts` keeps a save that the
quota refused in the queue for a later cycle, because space can come back. A
lapsed plan needs exactly this behaviour.

**Limits and jobs hold across processes.** Record 0121 moved the attempt
counters to PostgreSQL and gave each job an advisory lock in
`packages/storage-server/src/coordination.ts`. Records 0124 and 0125 wake the
sync notices through PostgreSQL. The server keeps no state in memory that a
second process needs, with one exception below.

**Attachments live on one disk.** `openAttachmentStore` in
`packages/storage-server/src/attachments.ts` writes each image under
`NOTESAPP_STORAGE_ROOT`, by workspace and digest. Two processes on two hosts
cannot share that directory. Only PNG, JPEG, GIF and WebP images are accepted,
each up to the bound `attachmentBytes` in `apps/server/src/config.ts`.

**Published pages already have their own origin.** Record 0118 serves the
reader path from `NOTESAPP_PUBLISHED_ORIGIN`, which sets no cookie and answers
no API. The `open` policy requires it.

**The legal documents are configuration.** Records 0140 and 0148 let the
operator name the terms and the privacy notice by an address or a Markdown
file, with a version that asks every account to accept again.

**The guide is a static site.** `apps/docs` builds `docs/guide/` into static
files with the one renderer and the one stylesheet (record 0152). It is hosted
apart from the application, today at the personal domain of the owner.

**Nothing is billed, measured or hosted.** The repository holds no payment
code, no plan, no metric route, no error tracker and no infrastructure code.
The release workflow pushes an `amd64` image to the GitHub registry. The
license is MIT. The product calls itself NotesApp in some places and Notesapp
in others.

## The first question: the name and the domains

NotesApp describes the product, so no office registers it as a trademark, and
every domain of the name is taken. The owner compared more than fifty names
against three checks: the `.com` and the `.page` domain are unregistered, the
USPTO register holds no live mark near the name for software, and the web shows
no product of that name in the notes market. Short words such as minimal,
simple, mono, zen, calm, pure and clear are the most crowded part of that
market. Minimal and Zen are direct competitors, and Simplenote owns the
simple notes space.

The owner chose **Tidy Notebook**. It says the promise of the product: notes in
order, as plain files, in a calm interface. All its domains were free, and no
product or live mark is near it. Its weak point is that "tidy" praises the
product, so a trademark office can call the name descriptive. The two words
together still form a mark.

**Two registrable domains.** `tidynotebook.com` holds the site, the
application and the guide. `tidynotebook.page` holds the published pages and
nothing else. One domain with a subdomain for the pages was the other option,
and it fails in two ways:

- A browser treats two subdomains of one registrable domain as one site. A
  hostile published page on `pages.tidynotebook.com` is then same-site with the
  application, and the SameSite cookie protection no longer separates them.
- A block list such as Google Safe Browsing, a corporate filter or a mail
  reputation list acts on a whole domain. One phishing page would then block
  the application, the checkout and the receipts of every customer.

Notion serves public pages from `notion.site`, GitHub from
`githubusercontent.com`, and Google from `googleusercontent.com`, for the same
reasons. Collaboration, which comes later, adds more content of other people,
so the split matters more over time. Shared workspaces stay on the application
origin, and a custom domain for a published page points at the `.page` domain.

`tidynotebook.app` is bought only to protect the name. The GitHub organization
`tidynotebook` holds the repository when it opens.

**What a rename costs.** A person sees the name in the web title, the manifest,
the wordmark, the mail, the guide and the README. The name becomes one constant
that every one of them reads. The package names `@notesapp/*`, the variables
`NOTESAPP_*`, the database names and the SQL functions stay. Nobody outside the
code sees them, and a rename of them breaks every self-hosted installation for
no gain.

## The second question: one code base or two

**Option A. A private fork for the cloud.** The cloud adds billing in a fork,
and the open repository has no billing. The cost is a second tree to merge on
each release, and two products that drift.

**Option B. A closed module that the open build leaves out.** The cost is a
build with two shapes, a boundary that a contributor cannot test, and code that
the open repository mentions but does not hold.

**Option C. One code base and one image, with billing behind configuration.**
The self-hosted edition is the default. The cloud sets `NOTESAPP_BILLING` to
`paddle` and names its keys. Every other line of code runs the same in both.

Option C is the choice. It keeps one test suite, one image and one release.
Billing code in an open repository leaks nothing, because a webhook secret and
an API key are configuration. The rule that holds it is simple: **the editions
differ in who pays, never in what the product does.** No feature is closed to
the self-hosted edition, and the self-hosted edition has no license key, no
telemetry and no request to any service of the owner.

The edition is a fact of the installation, so the database records it. The
server writes the billing mode into the one row of installation settings at
startup. The server refuses to start when the mode in the environment differs
from the mode in the row and any account exists, because a switch from `off`
to `paddle` would lock every account out, and a switch back would give every
account free access.

## The third question: the license

The repository is private and carries the MIT license. When it opens, a
competitor could run the same code as a paid service, which MIT allows with no
duty to share a change.

**Option A. Keep MIT.** It is the simplest license and the most liked by
contributors. It gives the cloud no protection.

**Option B. AGPL-3.0.** A service that runs a changed copy must offer its
source to its users. Plausible, Cal.com, Mastodon and Nextcloud use it. It is
an OSI license, so the self-hosted edition is fully open source.

**Option C. A source-available license, such as BSL or the Elastic license.**
It forbids a competing service. It is not open source, which breaks the promise
of a free open-source edition.

Option B is the choice, as AGPL-3.0-only. The owner holds every copyright
today, so the change needs no consent from anybody. Contributions come in under
the same license with a Developer Certificate of Origin sign-off, and no
contributor license agreement. The owner needs no special right over a
contribution, because the cloud runs the public code and is bound by the same
terms.

The repository opens when the cloud launches, because the launch is the moment
when everything is decided and every edition works.

## The fourth question: the payment provider

The product sells a digital service to people in many countries, in US dollars,
per user. Each sale owes the sales tax, VAT or GST of the country of the buyer.

**Option A. Stripe Billing, with Stripe Tax.** The best API and the lowest fee.
The owner is the seller, so the owner registers for tax in each place that
requires it and files each return. Stripe calculates the tax but does not pay
it.

**Option B. Stripe Managed Payments.** Stripe acts as the merchant of record.
It accepts sellers from a short list of countries only, and India and most
emerging markets are not on it, so it ties the business to where its owner is
based.

**Option C. Paddle Billing.** Paddle is the merchant of record. Paddle sells
the subscription to the buyer, collects and pays every tax, writes every
invoice, runs the retries of a failed payment, handles disputes, and pays the
owner. The fee is higher than Stripe's, about five cents of each dollar plus a
fixed part, and it includes all of that work.

**Option D. Lemon Squeezy or Polar.** Both are merchants of record. Lemon
Squeezy belongs to Stripe now and moves its sellers to Stripe Managed Payments.
Polar is young and focused on developer tools.

Option C is the choice. It removes tax, invoices and dunning from the owner,
which is the request. Paddle supports a quantity on each price, which is a seat
count, a change of quantity with proration, a customer portal for the payment
method, the invoices and the cancellation, and signed webhooks. The official
Node SDK, `@paddle/paddle-node-sdk`, carries the API and the signature check.

Paddle approves a seller by the website. The site must show the product, the
prices, the terms, the privacy notice and a refund policy, and the terms must
name the seller. The refund policy must be a clean guarantee with no
conditions. The cloud gives a full refund of any payment that a person asks for
within `14 days` of the charge.

## The fifth question: what a plan is

**Plans differ in limits, never in features.** A feature that only one plan
has needs a check in each screen and each handler that touches it, and it
contradicts the rule that the self-hosted edition has every feature. A limit
already has one place to live, the account row, and one place that checks it,
the database. So each plan is a set of numbers.

**Two plans.** One plan is the simplest, but a person with many images needs
more room than a person who writes text, and a single price is either too high
for the first or too low for the second. Two plans with the same features and
different room answer both. A third plan adds a choice and no new buyer.

**No trial and no free plan.** The refund guarantee does the work of a trial,
with a card on file, and it keeps every account on the cloud a paying one. An
account with no plan cannot write, so it costs almost nothing.

**Monthly and yearly.** The yearly price is ten times the monthly price, so a
year costs ten months. The prices are in US dollars and exclude tax, which
Paddle adds where it applies.

| Plan     | Monthly, each user | Yearly, each user | Storage | Note text and history | Published pages, each month |
| -------- | ------------------ | ----------------- | ------- | --------------------- | --------------------------- |
| Standard | `$5`               | `$50`             | `10 GB` | `2 GB`                | `10 GB` of transfer         |
| Pro      | `$10`              | `$100`            | `50 GB` | `2 GB`                | `50 GB` of transfer         |

Each number has a reason.

- **Storage** is the account limit of record 0112. It counts every byte of
  text, of history and of images. The images go to object storage, which is
  cheap.
- **Note text and history** is a second limit inside the first. Text and
  history live in PostgreSQL, where a byte costs more than in object storage,
  and it is the only way to make the database grow fast. No person who writes
  by hand comes near it. A script that writes text does, and the limit stops
  it at a cost that the price of the plan covers.
- **Published transfer** is the bytes that published pages of the account send
  to readers in one calendar month. A reader is a stranger, so this is the one
  traffic that the account does not bound by itself. The cloud pays for each
  byte that leaves it.

A GB here is `1000000000` bytes, because a person reads it that way. The
catalog in `packages/core` holds the numbers, and the site, the server and the
checkout all read the catalog, so a price or a limit changes in one place.

## The sixth question: for each user

"Per user" can mean two things. Each person pays for themselves, or one person
pays for a group.

**Option A. One person, one subscription.** The simplest model. A company
cannot buy for its staff, and the price "per user" means nothing more than "per
account".

**Option B. A subscription with seats.** The buyer chooses a plan and a number
of seats. The buyer holds the first seat and invites a person to each other
seat. The cloud covers each account that holds a seat. Paddle charges the price
times the number of seats.

Option B is the choice, because it is what "per user" means to a buyer, and the
pieces already exist. An invitation already carries a target (record 0108), and
design 015 planned a second target for sharing. A seat is that second target.

The rules of a seat:

- **The buyer is the billing owner.** The billing owner always holds one seat,
  so a subscription has at least one. A subscription has at most `100` seats,
  which is the default maximum of a Paddle price.
- **A seat covers an account and does not share it.** Each person keeps their
  own notes. Sharing a workspace is the later collaboration design, and a seat
  is the natural group for it.
- **An invitation names an address.** The person accepts with a new account,
  or with an existing account that no plan covers. An account that holds
  another seat, or pays its own subscription, cannot take a seat until it
  leaves that one.
- **A seat ends in three ways.** The billing owner removes the member, the
  member leaves, or the member removes their account. The account keeps its
  notes and falls to the rules of an account with no plan. The member can then
  buy their own plan.
- **The seat count changes in the application.** The Paddle portal cannot
  change a quantity. The billing page raises or lowers the count through the
  API with immediate proration: a raise charges the rest of the period at once,
  and a lowering credits it. The count cannot go below the seats in use and
  the open invitations.
- **The plan and the interval change in the application** too, with the same
  proration. A change applies to every seat. A lower plan never deletes a note.
  An account over the new limit works as a full account works today: it reads,
  exports and deletes, and a new write waits.
- **The billing owner cannot hand the subscription to another person.** To
  move it, the billing owner cancels, and the new payer subscribes and invites
  the members again. A transfer adds a flow that few teams need at launch.
- **A billing owner who removes their account cancels the subscription at
  once**, after a confirmation that names it. The right to erasure cannot wait
  for the end of a period. Every member then falls to the rules of an account
  with no plan, and receives a mail.

## The seventh question: an account with no plan

An account has no plan in four cases: it signed up and never paid, its
subscription ended, it left a seat, or Paddle stopped the subscription after
the last failed retry.

**Option A. Refuse the sign-in.** The person cannot even export their notes.
That breaks the promise that the notes stay theirs.

**Option B. Delete at once.** The same problem, and worse.

**Option C. Read only, then removal after a fixed time.** The account signs in,
reads, searches, exports and deletes. It cannot add a byte. Its published pages
show the closed page of record 0146, because a page of an account that does not
pay still costs transfer. After a fixed time with no plan, the removal of
record 0111 erases the account.

Option C is the choice. It costs almost nothing, because an account that
cannot add a byte cannot grow, and it keeps the notes of a person for long
enough to come back.

**Read only is the quota rule with a limit of zero.** The account row carries
whether a plan covers it. `notesapp_add_usage` refuses every write of an
account with no plan, with its own error, `plan_required`. The client already
keeps a save that the quota refused in its queue. A save refused for the plan
waits in the same way, so no work is lost, and it goes through when a plan
covers the account again. The editor opens a note read only while the account
has no plan, and one notice row names the reason and the one action that helps.

**The times.**

- An account that never had a plan is removed `30 days` after it was made.
  It holds nothing, because it could never write.
- An account that had a plan keeps its notes for `90 days` after the plan
  ended. A mail goes out when the plan ends, `30 days` before the removal and
  `7 days` before it.
- A subscription in `past_due` still covers its accounts. Paddle retries the
  payment and mails the buyer. When Paddle cancels after the last retry, the
  plan ends.

## The eighth question: how the subscription reaches the server

**Option A. Read Paddle on each request.** Every request then waits for Paddle,
and an outage of Paddle stops the product.

**Option B. Webhooks alone.** Paddle posts each change. A lost webhook leaves
the account wrong until the next change.

**Option C. Webhooks, with jobs that reconcile.** Paddle posts each change. An
hourly job reads the Paddle events after the newest one that the server stored,
and applies each one that it lacks. A daily job reads every live subscription
and applies it again.

Option C is the choice. Four rules make it safe:

- **The signature first.** The handler checks the `Paddle-Signature` header
  against the raw body with the webhook secret, through the SDK, before it
  reads anything.
- **Each event once.** The database keeps the identifier of each event, so a
  repeated delivery changes nothing.
- **The newest snapshot wins.** Each subscription event carries the whole
  subscription. The database applies it only when it is newer than the stored
  one, so two events that arrive out of order end in the right state.
- **One function applies a snapshot.** The webhook, the reconciling job, the
  answer of an API change and the command `pnpm billing:sync` all call it. It
  locks the subscription, stores the snapshot, and sets the coverage and the
  limits of every account that holds a seat, in one transaction. No other code
  writes the coverage of an account.

The webhook answers at once after its transaction, and Paddle retries a failed
delivery. A commit sends a notice to each account whose coverage or limits it
changed, so an open application sees the change without a reload.

## The ninth question: the checkout

**Option A. Paddle.js inside the application.** The checkout opens over the
application. The cost is a third-party script on the origin that holds the
session, and a content policy that trusts Paddle on every screen.

**Option B. A hosted checkout link.** Paddle hosts the page. A link takes a
price but no reference to the account, so the server cannot tie the payment to
the person who clicked.

**Option C. A transaction that this server creates, opened on the site.** The
application asks this server for a checkout. The server creates the Paddle
customer of the account when it has none, then a transaction with the price,
the seat count and the account in its custom data, and stores the identifier
of the transaction beside the account. It answers the address of the checkout
page of the site with the transaction in the query. That page loads Paddle.js,
which opens the checkout of that transaction. Paddle requires this page anyway:
it is the default payment link of the seller, and Paddle mails it for an
invoice that a buyer must pay by hand.

Option C is the choice. The script of Paddle runs only on one page of the
static site, which holds no session. The server ties the payment to the
account through the transaction it made, not through data that a browser sent.
When the payment completes, Paddle.js returns the person to the billing page of
the application. That page waits on the `billing` notice of the eighth question,
and it shows a plain state while the webhook is on its way.

## The tenth question: the landing site

**Option A. A route of the web application.** A signed-out visitor would load
the application shell to read a marketing page, and the first screen of the
application stays the sign-in screen that it is today.

**Option B. A part of the guide site.** The guide is for both editions and is
built from `docs/guide/`. Marketing text there would mix the audiences and the
sources.

**Option C. A static site of its own, `apps/site`.** It follows the shape of
`apps/docs`: pure modules that answer HTML, one build step that writes files,
the one stylesheet, the recipes of `packages/ui`, and the checks of
`tools/check-design-rules.mjs`.

Option C is the choice. The site serves `tidynotebook.com`:

- `/` states what the product is and why: plain Markdown files, offline work,
  every version kept, search, published pages, and a free edition to host.
- `/pricing` shows both plans from the catalog, what each plan includes, and
  the answers to the common questions: refunds, cancellation, export, taxes,
  data location and the self-hosted edition.
- `/self-hosted` describes the free edition and links the guide and the
  repository.
- `/checkout` is the Paddle page of the ninth question, and the one page with a
  script of a third party.
- `/terms`, `/privacy` and `/refunds` are the legal pages. The application
  names the first two by address, through the settings of record 0140, so one
  text serves both.

The site loads no analytics script and sets no cookie. The one filled button of
a page is its main action, as `docs/development/design.md` asks. A picture of
the application on the site is one of the light and dark screenshots that each
landing already takes.

## The eleventh question: where the bytes live

The cloud runs several server processes on several hosts, and an attachment
written by one must be readable by all.

**Option A. A shared network file system, such as EFS.** No code changes. The
cost is a file system that is slower, priced several times higher than object
storage, and one more thing to keep healthy.

**Option B. Object storage with the S3 API.** It is cheap, durable, and every
cloud and every self-hosted object store speaks it. The cost is a second
adapter of the attachment store.

Option B is the choice. The bytes of a finished attachment go to S3. Its
metadata stays in PostgreSQL, as now. Temporary uploads, the inspection of an
image and the body of an import stay on the local disk of the process, because
each lives for one request. The object key equals the relative path that the
file store uses today, so an installation moves between the two by copying the
files. The file store stays the default, and a self-hosted installation can
choose S3 with the same setting.

## The twelfth question: where the cloud runs

The cloud needs a container that runs the image, PostgreSQL with roles, row
level security, advisory locks and `LISTEN`, object storage, mail, and an
edge that ends TLS and stops abuse.

**Option A. A platform such as Render or Fly.io.** Little to operate. The
managed PostgreSQL of these platforms limits roles or connections in ways that
the three database roles of this product need, the regions are few, and the
owner depends on one small vendor for everything.

**Option B. One host with Docker Compose, as a self-hosted installation.** The
cheapest. It does not scale, and one host failure stops the service.

**Option C. Kubernetes.** It scales, and it is a second product to operate.

**Option D. AWS, with ECS on Fargate, RDS, S3 and SES, written in OpenTofu.**
Each part is managed: no host to patch, a database with a standby in a second
zone and restore to any second of the last weeks, and object storage built for
durability. The cost is more configuration, which the code in `infra/` holds,
and a bill that needs limits, which the thirteenth question gives.

Option D is the choice, in the region `eu-central-1`. Data in the EU suits a
product that sells privacy, and an offline-first client hides the distance to
a person in another continent. The shape:

- **Accounts.** One AWS organization with a management account, a staging
  account and a production account. A mistake in staging cannot touch
  production, and each account has its own budget.
- **Network.** One VPC over two zones. The load balancer and the tasks sit in
  public subnets, and a security group lets a task take traffic only from the
  load balancer. The database sits in private subnets. No NAT gateway, because
  it costs more than the rest of the network and the tasks need only outbound
  calls to Paddle, the breach range service and SES. A gateway endpoint reaches
  S3.
- **Compute.** One ECS service on Fargate with ARM64 tasks, at least two, at
  most six, scaled on CPU. An application load balancer in front, with AWS WAF.
- **Database.** RDS for PostgreSQL 18, in two zones, with automated backups for
  `35 days`, deletion protection, and a daily copy of the backups to
  `eu-west-1`.
- **Objects.** One S3 bucket for attachments, with versioning, and a replica
  in `eu-west-1`.
- **Mail.** SES in the region, with DKIM and a custom sending domain. The
  server speaks SMTP to it through record 0150, with no new mail code.
- **Static sites.** The site and the guide are S3 buckets behind CloudFront.
- **Names.** Route 53 holds both zones. ACM holds the certificates.
- **Secrets.** Secrets Manager holds each secret, and ECS gives it to the task.
  The migration runs as a separate task with the migration role, so the
  serving tasks never hold that secret.
- **Deploy.** A release tag builds the image for `amd64` and `arm64`. A manual
  workflow copies one release to the registry of an environment, runs the
  migration task, rolls the service, and publishes the two static sites.
  Production needs the approval of the owner.
- **Support mail.** Fastmail receives `support@tidynotebook.com`. Paddle
  handles the questions about a payment.

## The thirteenth question: every cost has a limit

Each line of the AWS bill and each outside service has a limit that holds it,
and an alarm that tells the owner before it matters.

| What costs money                      | The limit that holds it                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Object storage                        | The storage limit of the plan, checked by the database for each write.                                                                            |
| Database storage                      | The text and history limit of the plan, and a maximum size of the RDS volume.                                                                     |
| Transfer to readers of a page         | The published transfer of the plan, counted for each answer of the reader path.                                                                   |
| Transfer to the devices of the person | The storage limit, times the devices that hold a session. The sessions of an account are already bounded, and WAF bounds the rate of one address. |
| Compute                               | The maximum task count of the service.                                                                                                            |
| Requests from strangers               | WAF: the managed common rules, and a rate limit for each address. The attempt counters of record 0121 stay behind it.                             |
| Accounts that never pay               | They cannot write, and they are removed after `30 days`. The proof of work and the address check of design 016 stay.                              |
| Mail                                  | The mail budget of each address that exists, a daily limit of seat invitations for each subscription, and the SES sending quota.                  |
| WebSocket connections                 | The bounds of record 0129, for each account and each process.                                                                                     |
| Imports and exports                   | The job bounds of record 0170.                                                                                                                    |
| Logs                                  | A retention of `30 days` in CloudWatch.                                                                                                           |
| The whole bill                        | An AWS budget for each account with alerts at three levels, and AWS cost anomaly detection, both by mail to the owner.                            |

**The published transfer holds across processes with a short delay.** A write
to PostgreSQL for each answer of the reader path would make each published
page cost a database write. Each process instead adds the bytes it sent to a
sum in memory for each account, and writes the sums to PostgreSQL every
`10 s`. A check reads the stored total and adds the sum of its own process.
Several processes can therefore pass the limit by the traffic of one interval.
That is a few cents at most, and it is the one place where a limit is not
exact. Record 0121 accepts a limit that holds across processes, and this one
does, with that delay.

**The alarms.** A CloudWatch alarm mails the owner when the load balancer
answers too many errors, when the latency rises, when a task does not start,
when the database runs out of CPU, of storage or of connections, when the
webhook fails, when the reconciling job finds a difference, and when SES
reports too many bounces. A Route 53 health check reads `/ready` of the
application from outside.

## What stays out

- **A free plan and a trial.** The refund guarantee replaces a trial.
- **A feature that only one plan or only one edition has.**
- **Sharing a workspace.** The collaboration design comes later. A seat is
  ready to be its group.
- **A transfer of the billing owner, and a pause of a subscription.**
- **Any currency other than US dollars.**
- **A price with a tax included.** Paddle adds the tax where it applies.
- **Analytics, an error tracker, and a public status page.** The logs, the
  alarms and the health check cover the launch.
- **A second region that serves traffic.** The copies in `eu-west-1` are for
  disaster recovery only.
- **A native application for a phone or a desktop.** The web application and
  its installable form serve both.

## What the gate must prove

- The database refuses a write of an account with no plan with `plan_required`,
  with the use case bypassed, and a deletion still works.
- The database refuses a text write past the text and history limit, and an
  image write past the storage limit.
- A save that the plan refused stays in the queue, and it goes through when a
  plan covers the account again.
- A seat cannot be taken past the seat count, also by two acceptances at the
  same time.
- A webhook with a wrong signature changes nothing. A repeated event changes
  nothing. An older snapshot after a newer one changes nothing.
- The snapshot function sets the coverage and the limits of every seat in one
  transaction, and a lost seat count removes the newest seats first and never
  the billing owner.
- The server refuses to start when its billing mode differs from the stored
  mode and an account exists.
- The published reader answers the closed page past the transfer of the month,
  and for an account with no plan.
- The removal job removes an account that never had a plan after its time, and
  an account whose plan ended after its time, and never an account with a plan.
- The site build reads its prices from the catalog, and a test fails when the
  page and the catalog differ.
- `pnpm billing:check` fails when a price in Paddle differs from the catalog in
  amount, currency or interval.
- The S3 adapter passes the same contract test as the file store, against a
  real S3 API in the test stack.
- `tofu validate` and `tofu plan` pass for both environments.

## Decisions

- [0186. One code base serves a paid cloud and a free self-hosted edition](../decisions/0186-one-code-base-serves-a-paid-cloud-and-a-free-self-hosted-edition.md)
- [0187. The product is Tidy Notebook on two domains](../decisions/0187-the-product-is-tidy-notebook-on-two-domains.md)
- [0188. The repository opens under AGPL-3.0-only](../decisions/0188-the-repository-opens-under-agpl-3-0-only.md)
- [0189. Paddle is the merchant of record](../decisions/0189-paddle-is-the-merchant-of-record.md)
- [0190. A plan is a row of one catalog and differs only in limits](../decisions/0190-a-plan-is-a-row-of-one-catalog-and-differs-only-in-limits.md)
- [0191. A subscription buys seats and a seat covers one account](../decisions/0191-a-subscription-buys-seats-and-a-seat-covers-one-account.md)
- [0192. An account with no plan reads and keeps its notes for a fixed time](../decisions/0192-an-account-with-no-plan-reads-and-keeps-its-notes-for-a-fixed-time.md)
- [0193. One function applies a subscription and webhooks feed it](../decisions/0193-one-function-applies-a-subscription-and-webhooks-feed-it.md)
- [0194. A checkout opens a transaction that this server creates](../decisions/0194-a-checkout-opens-a-transaction-that-this-server-creates.md)
- [0195. The landing site is a static site of its own](../decisions/0195-the-landing-site-is-a-static-site-of-its-own.md)
- [0196. An attachment can live in S3](../decisions/0196-an-attachment-can-live-in-s3.md)
- [0197. The cloud runs on AWS from OpenTofu in infra](../decisions/0197-the-cloud-runs-on-aws-from-opentofu-in-infra.md)
- [0198. Every cost of the cloud has a limit](../decisions/0198-every-cost-of-the-cloud-has-a-limit.md)

[Plan 019](../plans/019-tidy-notebook-cloud.md) orders the work.
