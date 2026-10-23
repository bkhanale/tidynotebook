# Proton Mail dark mode

Source review: 23 October 2026. This records the public client code at the
linked commits. An installed client can use an older build. The local browser
checks below do not replace checks in the installed mail clients.

## Client behaviour

| Client  | Behaviour in the source                                                                                                                                                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS     | The app passes the selected theme to the shared SDK, then loads the SDK HTML in a WebView. For ordinary HTML senders, the SDK injects its own dark colours. Sender media queries and colour scheme metadata do not opt out of this transform.                                |
| Android | The same SDK transforms HTML. With media query support, its added rules use `prefers-color-scheme: dark`. Without that support, the app requests unconditional dark rules when the message is dark.                                                                          |
| Web     | The renderer keeps the sender's head styles in an iframe. The stylesheet filter does not remove colour scheme media queries. These queries follow the browser's scheme. The app also adds its own `proton-dark-theme` class. This is separate from the mobile SDK transform. |

Sources for the platform paths:

- iOS: [theme options](https://github.com/ProtonMail/ios-mail/blob/701463fe4542945c49ac5d326b0c27e91441e02f/Modules/App/Sources/UI/Extensions/ThemeOpts.swift),
  [body provider](https://github.com/ProtonMail/ios-mail/blob/701463fe4542945c49ac5d326b0c27e91441e02f/Modules/App/Sources/DataSources/MessageBodyProvider.swift).
- Android: [message theme options](https://github.com/ProtonMail/android-mail/blob/17fe04fd0f8b9b7dc45c188d4d5e2d55033128c0/mail-message/domain/src/main/kotlin/ch/protonmail/android/mailmessage/domain/model/MessageThemeOptions.kt),
  [WebView fallback](https://github.com/ProtonMail/android-mail/blob/17fe04fd0f8b9b7dc45c188d4d5e2d55033128c0/mail-detail/presentation/src/main/kotlin/ch/protonmail/android/maildetail/presentation/usecase/ApplyWebViewDarkModeFallback.kt).
- Web: [iframe HTML](https://github.com/ProtonMail/WebClients/blob/22da12977108b6c90c025cd295d2873f8427477c/packages/mail-renderer/src/helpers/getIframeHtml.ts),
  [stylesheet filter](https://github.com/ProtonMail/WebClients/blob/22da12977108b6c90c025cd295d2873f8427477c/packages/mail-renderer/src/helpers/transforms/transformStylesheet.ts),
  [iframe theme class](https://github.com/ProtonMail/WebClients/blob/22da12977108b6c90c025cd295d2873f8427477c/packages/mail-renderer/src/components/MessageBodyIframe.tsx).

The SDK chooses native sender styling only for trusted senders. It does not use
`color-scheme` metadata to make that choice. It processes inline colours,
stylesheet colours and old HTML colour attributes. It can remove inline colour
priority and append rules with higher specificity. Thus `!important` alone does
not stop the mobile transform. See the SDK
[support selection](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/support_level.rs)
and [style injection](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/mod.rs).

There is no sender-facing `[data-ogsc]` or `[data-ogsb]` contract in these Proton
paths. The SDK's `data-protonmail-message` selector is its own scope, not a hook
that an email author must add. Keep the Outlook selectors for Outlook. Do not
add a Proton selector that depends on private client markup.

## Fix

The SDK treats borders as backgrounds. A fixed white border can therefore turn
dark. It leaves `currentColor` unchanged. The HTML button uses a two-pixel
`currentColor` border so the boundary follows the readable text. Padding falls
from `12px 22px` to `10px 20px`, which keeps the 48-pixel height and total width.
The Outlook VML button also gets a two-pixel white stroke. Its fixed stroke is
an Outlook fallback, not the mechanism used in Proton. See
[property purposes](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/dark_mode_visitor/properties.rs)
and [colour rules](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/colors.rs).

The panel uses a small cool tint derived inside `renderEmail`: fifteen parts
of `surfaceHover` and one part of `accentText`, per RGB channel. The results
are `#e3e6ea` in light and `#2f3338` in authored dark. The copied Default palette
is unchanged, and the product theme does not change. Panel-to-card contrast is
1.25:1 in each authored mode. Proton maps the light fill to `#424b57`, at 1.96:1
against its card. Its transformed dark fill also passes the 1.15:1 grouping
target. Panel text passes 4.5:1 in all these cases. This keeps the grouping
without the old olive tint or the first fix's nearly invisible neutral fill.

The purple links in the owner's image are Proton-created links around
plain-text domains in the body and footer. Proton supplies
`a:link{color:var(--primary)}`, with `--primary: #8a6eff`. The authored fallback
URL already had an inline colour and appeared pale blue. The new base `a` rule
covers client-created anchors. Its authored dark counterpart is `a,.link`,
including the Outlook hooks. The button's class rules still win over `a`.
See the SDK [base link CSS](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/colors.css)
and [foreground contrast check](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/dark_mode_visitor/declaration_block.rs).
The simulation inserts these domain anchors and checks their final contrast.
Proton can still choose a different link hue in an installed build.

Proton also processes the sender's dark media rules. An unchanged inline
`#1a1917` fill creates no override. The authored dark `#ececea` fill maps to
`#16171d` and can win instead. This explains the owner's sampled button fill
`#16171c`, within one channel value of the model. A simulation that transforms
only computed light styles misses this path. See
[stylesheet processing](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/dark_mode_visitor/stylesheet.rs).

The anchor owns the fill. The cell has no fill, so there is no dark hairline
outside the light button's border. A fixed fill-colour border comes before
`border-color:currentColor`. If a client drops the latter declaration, the
fixed border keeps the button size. The dark rules now set the anchor fill.

The default light CID image uses the existing official application icon tile.
Its embedded opaque background keeps the notebook mark readable if the client
cannot apply dark media queries. The authored dark CID mark stays unchanged.
Neither image needs a remote load. The simulation uses the actual CSS logo
rules; it does not force a logo switch.

Keep both `color-scheme: light dark` metadata entries, the root properties,
media queries, CID image delivery, Outlook selectors and VML. These metadata entries
already existed. They support authored dark rendering, including
[WebKit dark mode](https://webkit.org/blog/8840/dark-mode-support-in-webkit/),
but do not disable Proton's transform.

## Checks

The regression model checks the original opaque HSL input/output pairs from
upstream cases 3, 4, 6 and 7, and the hex pair from case 8. A separate test
compares only the owner's sampled pixel colours, with a one-channel-value
rounding tolerance. No inbox image or token is stored in the repository.
The tests cover `currentColor` being skipped, unchanged inline colours creating
no override, both possible Proton button fills, full RGB inversion, dark
unclassed anchors and panel contrast.

The forced-dark browser renders process declaration blocks in the sender's
stylesheets, including dark media rules, and then inline and `bgcolor` values.
Only changed values create more specific colour overrides. Original media
queries still control layout and logos. The added Proton base anchor style
uses `#8a6eff`. Domain detection inserts local test anchors before the contrast
checks. The Android no-media variant applies the outer colour supplement
without a media query while the sender's dark media rules do not match.
Its default light logo must remain readable.

These are source-based simulations, not native Proton screenshots. They cover
the template's opaque colours and simple selectors, not the complete Rust
parser, colour profiles, WebView, VML or image policy. Native Proton iOS and
Android checks remain a release gate, including the fallback logo path.

Before release, check a verification and password reset email in Proton iOS,
Android and web, Gmail, Outlook and Apple Mail, in light and dark:

1. The button boundary and label are visible. The whole button opens the right link.
2. The panel is neutral and its text is readable.
3. Links remain readable before and after a visit.
4. The logo and wordmark are visible. Long links do not cause horizontal scroll.
5. In Outlook desktop, the VML button has a visible boundary and no extra block.

## Cloud mirror follow-up

After the core merge, use the merge commit as the source for the cloud mirror.
Do not edit cloud from this task.

1. Copy `renderEmail` verbatim from core
   `apps/server/src/auth/email-template.ts` at the merge commit into
   `packages/mail/src/email-template.ts`. Keep the token expressions, local
   panel calculation and declaration order. Do not substitute literal colours.
   `emailPalettes` and the other renderer declarations are unchanged.
2. Refresh the mirrored light CID PNG from core's generated
   `apps/server/src/auth/email-logo.ts`. Keep the cloud module's existing type
   imports. The dark image and both content IDs are unchanged.
3. Set `core.json` `ref` to that merge SHA. Update `image` if the existing pin
   workflow requires it.
4. Regenerate the three
   `packages/mail/src/fixtures/emails/plan-ended*.html.golden` files. The text
   goldens do not change.
5. Run `pnpm lint`, which includes the drift check, and `pnpm test:unit`.
   Porting the Proton regression tests is optional and needs cloud's own
   `emailExamples`.

No message copy, URL, mail configuration or plain-text change is needed.
