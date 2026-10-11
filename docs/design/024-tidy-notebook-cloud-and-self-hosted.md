# 024: Tidy Notebook, a paid cloud and a free self-hosted edition

Status: active

This design states how the product becomes a free open core and a paid cloud.
The owner hosts a paid cloud service with a subscription for each user. Any
person can host the same product for free, and it stays private to that
person. The design covers the name of the product, the boundary between the
open core and the private billing service, the payments, the hosting, and the
limits that keep each cost of the cloud bounded. It closes every choice, so the
plan can be built in order with no question left.

[Design 015](015-several-accounts-on-one-installation.md) gave one installation
several accounts, and [design 016](016-a-public-service.md) made one
installation safe for strangers. Design 016 named the account quota as "the
point where a plan would attach". This design attaches the plan there, from
outside the core.

## The problem

The product is a self-hosted application today. One person runs it for
themselves and for the people they invite. The owner now wants three more
things.

1. **A landing site.** It describes the product, lists the plans and what each
   plan gives, and leads a visitor to a subscription.
2. **Payments.** A person subscribes to a plan, in US dollars, for each user.
   The owner sells from India and must spend as little time on it as possible:
   no tax filing in each country, no invoice by hand, no failed payment to
   chase.
3. **Hosting.** The cloud must be able to grow, and it must start inside a
   monthly budget of `$20`. The subscription decides who has access, and every
   resource that costs the owner money has a limit.

The cloud has no free plan. The self-hosted edition has every feature, costs
nothing, sends nothing to the owner, holds no billing code, and becomes open
source.

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
account. A deletion keeps a small reserve so it works on a full account.

**An account can already be disabled and removed.** Record 0111 disables an
account, which ends its sessions, and removes an account, which leaves a
tombstone.

**A refused save waits.** `packages/sync/src/queue.ts` keeps a save that the
quota refused in the queue for a later cycle, because space can come back.

**Limits and jobs hold across processes.** Record 0121 moved the attempt
counters to PostgreSQL and gave each job an advisory lock. Records 0124 and
0125 wake the sync notices through PostgreSQL, and record 0129 sends an `a:`
hint when the state of an account changes.

**Attachments live on one disk.** `openAttachmentStore` in
`packages/storage-server/src/attachments.ts` writes each image under
`NOTESAPP_STORAGE_ROOT`. Two replicas cannot share that directory.

**Published pages can have their own origin.** Record 0118 lets an
installation serve the reader path from `NOTESAPP_PUBLISHED_ORIGIN`, and record
0114 requires one for the `open` policy.

**Every operation needs a person.** No operation of the contract accepts a
credential of a service.

**Nothing is billed or hosted.** The repository holds no payment code, no plan
and no hosting code. The license is MIT. The product calls itself NotesApp in
some places and Notesapp in others.

## The first question: the name and the domain

NotesApp describes the product, so no office registers it as a trademark, and
every domain of the name is taken. The owner compared more than fifty names
for a free `.com` domain, no live mark near it for software, and no product of
that name in the notes market. The owner chose **Tidy Notebook**. It says the
promise of the product: notes in order, as plain files, in a calm interface.
Its weak point is that "tidy" praises the product, so a trademark office can
call the name descriptive. The two words together still form a mark.

The owner bought `tidynotebook.com` at Cloudflare. Cloudflare Registrar
requires Cloudflare DNS, so Cloudflare holds the zone. A second registrable
domain for published pages was considered, and the fifteenth question below
explains why the owner keeps one domain.

Every host is one level under the domain: `app`, `billing`, `docs`, `mail`,
and `app-staging` and `billing-staging` for staging. The free certificate of
Cloudflare covers one level, so a name such as `staging.app` would need a paid
certificate.

**What a rename costs.** A person sees the name in the web title, the manifest,
the wordmark, the mail, the guide and the README. The name becomes one
constant that every one of them reads. The package names `@notesapp/*`, the
variables `NOTESAPP_*`, the database names and the SQL functions stay. Nobody
outside the code sees them, and a rename of them breaks every self-hosted
installation for no gain.

## The second question: where the billing code lives

The owner wants the open repository and its image to hold nothing about
payments. Three patterns are common.

**P1. One repository, billing behind a setting.** Joplin Server, Bitwarden and
Cal.com work this way. The billing code is in the open code and the open
image, and it does not run unless a setting turns it on. It keeps one test
suite, but it fails the request of the owner.

**P2. One repository, billing in a folder that the open build leaves out.**
Plausible CE, GitLab FOSS and PostHog FOSS work this way. The open image holds
no billing, but the open repository still does.

**P3. An open core and a private cloud repository.** Sentry with its private
`getsentry` and Ghost(Pro) work this way. Only this pattern keeps billing out
of the open repository. It has two forms:

- **P3a. A separate private service.** The core offers general controls of an
  account and an API for an operator. The service talks to Paddle and sets
  those controls over HTTP.
- **P3b. A private plugin in the same process.** The cloud image adds a
  private module to the core.

The license decides between the two. The core opens under AGPL, and outside
contributions come in under AGPL with a sign-off and no contributor license
agreement. Private code that runs in the same process as that code must be
offered as source too, unless every contributor signs a CLA, which keeps many
contributors away. A separate program that talks over HTTP is not a part of
the core.

**P3a is the choice.** The core holds no payment provider, no plan, no price
and no billing screen. One image serves both editions, and the cloud runs the
public image with no change. The private repository `tidynotebook/cloud` holds
the billing service, the landing site and the runbook of the cloud. The cost
is a second program, an API between the two, and a second set of pages.

The rule that holds it: **the self-hosted edition has every feature.** Teams
and collaboration, when they exist, are in the core. Only the cloud turns a
feature off for an account that does not pay for it. The self-hosted edition
has no license key, no telemetry and no request to any service of the owner.

## The third question: the license

The repository is private and carries the MIT license. When it opens, a
competitor could run the same code as a paid service, which MIT allows with no
duty to share a change.

**Option A. Keep MIT.** It is the simplest license. It gives the cloud no
protection.

**Option B. AGPL-3.0.** A service that runs a changed copy must offer its
source to its users. It is an OSI license, so the self-hosted edition is fully
open source. Most open notes products that also sell a cloud use it: Joplin,
which moved from MIT, Standard Notes, Logseq, AppFlowy and Trilium.

**Option C. A source-available license, such as BSL.** It forbids a competing
service. It is not open source, which breaks the promise of a free open-source
edition.

Option B is the choice, as AGPL-3.0-only. The owner holds every copyright
today, so the change needs no consent from anybody. Contributions come in under
the same license with a Developer Certificate of Origin sign-off. The repository
opens when the cloud launches.

## The fourth question: what the core offers to a plan

A plan needs four things from the core: a limit on the bytes that cost the
most, a way to stop the writes of an account that does not pay, a switch for a
feature of one plan, and a removal after a time. None of them names a payment,
so each is a general control of an account that a self-hosted operator can use
too.

The account row carries the storage limit that exists, a text limit, a
published transfer limit, a download limit, a standing that is `active` or
`locked`, a removal time while it is `locked`, and a switch for each feature
that a later design makes switchable. Teams and collaboration are the first two
switches, and each is on by default. The configuration gives the controls of a
new account, and with no setting a new account is `active` with every feature,
as today.

**A revision guards each write.** The controls carry a revision that the core
raises on each change, and a write names the revision that it read. A write
that was computed from an old state therefore cannot replace a newer one, for
example a retried activation that arrives after a cancellation.

**The text limit** sits inside the storage limit. Text and history live in
PostgreSQL, where a byte costs more than in object storage, and only a script
comes near the limit. `workspace_usage` counts text apart from attachments,
and `notesapp_add_usage` checks both sums.

**A locked account** signs in to one screen. When the operator names an account
portal, the screen links it as the one action that unlocks the account. One
list names the operations that a locked account keeps: the identity and
session operations, the consent to new legal documents, the read of its own
account and workspaces, the export, the portal handoff, the sync notice
stream, and the removal of the account. Every new account of the cloud starts
locked, so the handoff must be on the list, or nobody could pay. The
database refuses every write of a locked account with `account_locked`, the
reader path closes its published links, and the client keeps a refused save in
its queue until the account is active again. The owner chose this over a read
only account: a person who does not pay sees only the way to pay and the way to
take the notes out.

**The removal** is a daily job that removes each locked account past its time,
through record 0111, with a mail `30 days` and `7 days` before.

## The fifth question: how the billing service reaches the core

**Option A. A database role for the service.** The service writes the account
rows itself. It ties a private program to the schema of the core, and a
migration of the core can break it in silence.

**Option B. An outbound webhook from the core.** The core posts each account
event to the service. The core then sends data out, which the self-hosted
promise forbids, and it needs a signature and a retry of its own.

**Option C. An operator API.** The core declares operations for a service
under `/api/operator/`, behind one bearer token from a file. The service sets
the controls, reads the usage, removes an account, and reads the account events
after a cursor of its own. The core sends nothing out.

Option C is the choice. Two more parts make it work.

- **The handoff.** The service must know which person opened it, but it reads
  no cookie of the core. The application asks the core for a single-use token
  that expires after `60 s` and opens the portal with it. The service redeems
  it through the operator API. This is the pattern of a sign-in link.
- **The private network.** The service calls the core by an internal host
  name. The operator operations skip the Host allowlist, as the probes do,
  because they set no cookie and answer no page.

## The sixth question: the payment provider

The product sells a digital service to people in many countries, in US dollars,
per user. Each sale owes the sales tax, VAT or GST of the country of the buyer.
The owner sells from India.

**Option A. Stripe Billing, with Stripe Tax.** The owner is the seller, so the
owner registers for tax in each place that requires it and files each return.
Stripe also takes a new seller in India only by invitation, with a video check.

**Option B. Stripe Managed Payments.** Stripe acts as the merchant of record,
but it does not accept a seller in India.

**Option C. Paddle Billing.** Paddle is the merchant of record. It sells the
subscription to the buyer, collects and pays every tax, writes every invoice,
retries a failed payment, handles disputes, and pays the owner. It has one
fee with no extra charge for a foreign card, a subscription, a refund or a
dispute. It accepts a seller in India.

**Option D. Dodo Payments or Polar.** Both are merchants of record that accept
a seller in India. On these prices their cost is about that of Paddle. Dodo
adds a fee for each refund, each dispute and each wire payout. The free plan
of Polar costs a little more than Paddle, and Polar is young.

Option C is the choice. It is the most established of the three, and its fee
is the simplest. Paddle supports a quantity on each price, which is a seat
count, a change of quantity with proration, a customer portal and signed
webhooks. The fixed part of the fee weighs most on a monthly charge for one
seat, so the yearly interval and a team charge cost less in fees, and the owner
asks Paddle for its pricing of a low price.

Paddle approves a seller by the website. The site must show the product, the
prices, the terms, the privacy notice and a refund policy. The cloud gives a
full refund of any payment that a person asks for within `14 days` of the
charge, and the owner grants each one in the dashboard.

## The seventh question: what a plan is

**Two plans.** Standard is for one person. Pro is for a team: it sells seats,
it turns on teams and collaboration, and it gives more room. History and
publishing are in both plans, because they are the core of the product.

**No trial and no free plan.** The refund guarantee does the work of a trial,
and it keeps every account on the cloud a paying one.

**Monthly and yearly.** The yearly price is ten times the monthly price. The
prices are in US dollars and exclude tax.

| Plan     | Monthly, each seat | Yearly, each seat | Seats        | Storage | Text and history | Published transfer, each month | Downloads, each month | Teams and collaboration |
| -------- | ------------------ | ----------------- | ------------ | ------- | ---------------- | ------------------------------ | --------------------- | ----------------------- |
| Standard | `$5`               | `$50`             | `1`          | `10 GB` | `2 GB`           | `10 GB`                        | `20 GB`               | Off                     |
| Pro      | `$10`              | `$100`            | `1` to `100` | `50 GB` | `2 GB`           | `50 GB`                        | `60 GB`               | On                      |

A GB here is `1000000000` bytes. The catalog of the billing service holds the
numbers, and its pages and the landing site read it.

## The eighth question: seats

A Pro subscription has seats. The buyer is the billing owner and holds the
first seat. The billing owner invites an address to each other seat, and the
person accepts with an account of that address that no plan covers. A seat
covers one account and shares nothing. Sharing a workspace is the later
collaboration design, and the members of a subscription are its first group.

A seat ends when the billing owner removes the member, when the member leaves,
or when the member removes the account. The billing owner changes the seat
count, the plan and the interval on the billing pages, with immediate
proration after a preview. The count cannot go below the seats in use and the
open invitations. The billing owner cannot hand the subscription to another
account, and a billing owner who removes the account cancels it at once,
because the right to erasure cannot wait for the end of a period.

## The ninth question: an account with no plan

An account has no plan when it never paid, when its subscription ended, when
it left a seat, or when Paddle stopped the subscription after the last failed
retry. It is `locked`.

- An account that never paid is removed `30 days` after it was made. It holds
  only an address and a password hash, because it could never write.
- An account whose plan ended is removed `90 days` after the plan ended.
- A subscription in `past_due` still covers its accounts while Paddle retries
  the payment.

## The tenth question: how the subscription reaches the service

Paddle's guide to provisioning access gives the usual pattern, and the
service follows it.

- **The signature first.** The handler checks the `Paddle-Signature` header
  against the raw body before it reads anything.
- **Each event once.** The service stores the identifier of each event.
- **The newest event wins.** Paddle does not promise the order of delivery, so
  the service applies a subscription event only when its `occurred_at` is
  newer than the stored one.
- **One function applies a snapshot**, and in the same transaction marks each
  account whose controls must change in an outbox. A worker computes the
  controls of each marked account from the newest billing state and writes
  them with the revision of the fourth question. The outbox names accounts,
  not payloads, so a restart loses no work and a retry never sends an old
  state.
- **A daily reconcile job** reads each live subscription again and repairs a
  difference. Paddle retries a failed delivery for days, so the job is the
  bound when the service was down for longer.

An hourly job over the event list of Paddle was considered, and the daily job
makes it unnecessary. An automatic refund of a duplicate subscription was
considered too. Instead, a checkout is refused for an account that already
pays, and a rare duplicate mails the owner, who refunds it by hand.

## The eleventh question: the checkout

**Option A. Paddle.js inside the application.** The cost is a third-party
script on the origin that holds the session of the core.

**Option B. A transaction that the server creates and opens by its
identifier.** It ties the payment to the account strictly, at the cost of more
code than the usual integration.

**Option C. The usual integration on the billing service.** On the first
checkout, the service creates the Paddle customer of the account and stores its
identifier. Paddle.js opens the checkout with that customer and with the
account in the custom data. The service finds the account from the customer of
each event, never from data that a browser sent.

Paddle lets a buyer change the customer of a checkout by default. The checkout
therefore sets `allowLogout` to `false`. A payment whose customer the service
does not hold still covers nothing: the service keeps it unattached and mails
the owner, who attaches it after a check or refunds it.

Option C is the choice. Paddle.js runs only on the billing origin, which holds
no session of the core. The billing service keeps its own session, made from
the handoff of the fifth question.

## The twelfth question: the landing site

A route of the web application would load the application shell to read a
marketing page, and a part of the guide would mix two audiences. The landing
site is a static site of the private repository, served by Cloudflare at
`tidynotebook.com`. It reads the catalog, so a price on a page cannot differ
from the price in the service. It loads no analytics, no cookie and no script
of a third party. The legal pages live there, and the core names the terms and
the privacy notice by address through record 0140.

## The thirteenth question: where the bytes live

The cloud runs several replicas, and a byte written by one must be readable
by all. A shared file system is slow and costs more than object storage.
Object storage with the S3 API is cheap and every store speaks it. The core
gains a second adapter of the store, and the cloud uses Cloudflare R2, which
charges no egress. The object key of a finished attachment equals the path of
the file store, so an installation moves between the two by copying files.

Two flows span more than one request, and the next request can reach another
replica. An image upload writes a temporary file that a second request
finalizes, so the upload writes the checked bytes to a staging key of the
store before it answers. An import sends one archive of up to the archive
limit, and the Cloudflare proxy refuses a request body above `100 MB`, so an
import goes up in parts through a multipart upload. A daily job removes a
staging key or an unfinished upload that nobody completed.

## The fourteenth question: where the cloud runs

The cloud needs a container that runs the image, PostgreSQL with roles, row
level security, advisory locks and `LISTEN`, object storage, mail, and an edge
that ends TLS and stops abuse. The budget is `$20` a month.

**Option A. AWS, with ECS on Fargate, RDS and a load balancer.** Each part is
managed and scales far. A database in two zones, two tasks and a load balancer
cost more than ten times the budget before the first customer.

**Option B. One host with Docker Compose.** The cheapest, and it does not
scale.

**Option C. Render.** Managed replicas and a managed database fit the budget.
Its backups reach back only a few days on the free workspace, and it was not
clear that its database user can make the roles of the core.

**Option D. Hetzner servers behind a Cloudflare Tunnel.** The most resources
for the money, but the owner runs PostgreSQL, its upgrades and its backups.

**Option E. Railway behind Cloudflare.** Railway charges for what the services
use. Its Pro plan runs several replicas of a service, its PostgreSQL gives a
superuser that makes the roles of the core, and it keeps point-in-time
recovery for weeks. A hard usage limit stops the services at a fixed amount.

Option E is the choice, on Pro in the EU West region.
[Record 0210](../decisions/0210-railway-pro-keeps-private-images-within-the-compute-budget.md)
keeps private images and the compute budget. Cloudflare on its free plan
holds DNS, the proxy, TLS, the rate rule, R2, the static sites and the
forwarding of the support address. Resend sends the mail on its free plan.
The database has no standby, and that is the cost of the budget: a failure of
it stops the service until Railway restarts it or the owner restores it. A
weekly dump to a separate R2 bucket keeps a copy off the platform, and a
lifecycle rule deletes each dump after `35 days`.

Three facts of the platforms shape the setup. Railway requires the Cloudflare
SSL mode `Full` for a proxied custom domain, so Cloudflare encrypts the traffic
to Railway without a check of its certificate. The image always migrates
before it serves today, so it gains a `migrate` and a `serve` command, and a
serving replica holds no migration credential. Railway checks a replica with
its own host name, so the probes skip the Host allowlist.

## The fifteenth question: one domain for published pages

A second registrable domain for published pages, such as `tidynotebook.page`,
keeps a hostile page from being same-site with the application, and keeps a
block list that acts on that page away from the application. Notion and GitHub
work this way.

The owner keeps one domain. Collaboration and published pages then live on the
one domain of the product, and the owner pays for one domain. The cost is
accepted: a phishing page that a stranger publishes can get
`app.tidynotebook.com` blocked until the takedown and a review clear it. A
page of a published link runs only the script of the product, under the
sanitized renderer, so the risk is the block list and not a script.

## The sixteenth question: every cost has a limit

Each line of the bill has a limit that holds it, and an alarm that tells the
owner.

- **Railway compute** keeps the usage alert and hard limit of record 0200.
  Record 0210 states how the Pro minimum and its included usage fit that
  budget. Production and staging share one compute limit.
- **Compute** is two replicas of the core and one of the billing service.
- **The database volume** is bounded by the text limit of each plan. Pro
  gives more volume space, but it does not raise a limit of an account.
- **Object storage** is bounded by the storage limit of each plan.
- **Object operations** cost money on a bill of their own, and an account can
  write and delete again and again below its storage limit. The core makes
  every call to the store, so it counts them, and a monthly cap on writes and
  on reads holds the R2 bill.
- **Transfer to readers** is bounded by the limit of each plan and by a cap
  of `50 GB` a month for the whole service.
- **Transfer to devices** is not bounded by storage times devices, because one
  session can download the same export again and again. The core counts the
  bytes of each authenticated response, and a monthly download limit of each
  plan and a cap of the whole service hold it. Past the limit, an export, an
  attachment and a snapshot wait for the next month, and the rest of the
  application keeps working.
- Each process keeps the counts in memory and writes them to PostgreSQL every
  `10 s`, so several processes can pass a limit by the traffic of one
  interval.
- **A flood** costs nothing, because Cloudflare absorbs it before Railway. The
  free plan gives one rate rule for the zone, which matches on the path and
  counts by address. It covers the paths of the API, and the webhook of Paddle
  sits on another path, so a burst of deliveries is never blocked.
- **Mail** is bounded by the free plan of Resend, the mail budget of each
  address, and a daily limit of seat invitations.

## What stays out

- A free plan and a trial.
- A feature that only one edition has.
- Billing code, a plan or a price in the open repository.
- Sharing a workspace. The collaboration design comes later.
- A transfer of the billing owner, and a pause of a subscription.
- Any currency other than US dollars, and a price with a tax included.
- Analytics, an error tracker and a public status page.
- A standby database and a second region. Both come with revenue.
- Infrastructure as code. The runbook lists each dashboard setting.

## What the gate must prove

In this repository:

- The database refuses a write of a locked account with `account_locked`,
  with the use case bypassed, and a locked account still exports and removes
  itself. A new locked account opens the portal and is unlocked by a control
  write.
- A control write with an old revision changes nothing.
- The database refuses a text write past the text limit, and an image write
  past the storage limit.
- A save refused with `account_locked` stays in the queue, and it goes through
  when the account is active again.
- The removal job removes a locked account past its time, and never an active
  account.
- A wrong or missing operator token changes nothing, a handoff works once and
  expires, and the event cursor misses no event.
- The published reader answers the closed page past the transfer of the month
  of an account and of the whole installation, with two server instances, and
  for a locked account. A download past the download limit or a cap answers
  `download_limit`, and the object operation caps hold.
- The S3 adapter passes the same contract test as the file store, against a
  real S3 API in the test stack. An upload through one server instance
  finalizes through another, and an import in parts crosses two instances.
- `serve` starts with no migration credential, and `migrate` exits after the
  migrations.
- A probe answers the host of Railway, and a normal route with that host does
  not.

In the private repository:

- A webhook with a wrong signature, a repeated event, and an older event after
  a newer one change nothing.
- A dropped cancellation still ends the coverage through the reconcile job.
- Two acceptances of the last seat make one member, and a lost seat count
  removes the newest seats first and never the billing owner.
- A forged custom data cannot cover another account, every checkout sets
  `allowLogout` to `false`, and a payment with an unknown customer covers
  nothing.
- A failed activation write, then a cancellation and a restart, end with the
  account locked.
- The site and the check command fail when a price differs from the catalog.

## Decisions

- [0186. The open core holds no billing, and a private service sells the cloud](../decisions/0186-the-open-core-holds-no-billing-and-a-private-service-sells-the-cloud.md)
- [0187. The product is Tidy Notebook on tidynotebook.com](../decisions/0187-the-product-is-tidy-notebook-on-tidynotebook-com.md)
- [0188. The repository opens under AGPL-3.0-only](../decisions/0188-the-repository-opens-under-agpl-3-0-only.md)
- [0189. An account carries limits, a standing and feature switches](../decisions/0189-an-account-carries-limits-a-standing-and-feature-switches.md)
- [0190. An operator API reaches the account controls](../decisions/0190-an-operator-api-reaches-the-account-controls.md)
- [0191. A published page of the cloud lives on the application origin](../decisions/0191-a-published-page-of-the-cloud-lives-on-the-application-origin.md)
- [0192. Uploads and attachments can live in an S3 compatible store](../decisions/0192-uploads-and-attachments-can-live-in-an-s3-compatible-store.md)
- [0193. Transfer and object operations have a limit](../decisions/0193-transfer-and-object-operations-have-a-limit.md)
- [0194. Paddle is the merchant of record](../decisions/0194-paddle-is-the-merchant-of-record.md)
- [0195. Two plans: Standard for one person and Pro for a team](../decisions/0195-two-plans-standard-for-one-person-and-pro-for-a-team.md)
- [0196. The billing service mirrors Paddle into the account controls](../decisions/0196-the-billing-service-mirrors-paddle-into-the-account-controls.md)
- [0197. The billing pages and the checkout live on the billing service](../decisions/0197-the-billing-pages-and-the-checkout-live-on-the-billing-service.md)
- [0198. The landing site is a static site of the private repository](../decisions/0198-the-landing-site-is-a-static-site-of-the-private-repository.md)
- [0199. The cloud runs on Railway behind Cloudflare](../decisions/0199-the-cloud-runs-on-railway-behind-cloudflare.md)
- [0200. Every cost of the cloud has a limit](../decisions/0200-every-cost-of-the-cloud-has-a-limit.md)
- [0201. A locked account keeps a fixed list of operations](../decisions/0201-a-locked-account-keeps-a-fixed-list-of-operations.md)
- [0202. The image takes a migrate and a serve command](../decisions/0202-the-image-takes-a-migrate-and-a-serve-command.md)
- [0210. Railway Pro keeps private images within the compute budget](../decisions/0210-railway-pro-keeps-private-images-within-the-compute-budget.md)

[Plan 019](../plans/019-tidy-notebook-cloud.md) orders the work.
