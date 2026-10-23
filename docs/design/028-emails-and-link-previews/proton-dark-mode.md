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

The light info panel now uses the existing `surface` token, `#f7f7f5`, instead
of `surfaceHover`, `#f0efec`. Proton classifies the first as neutral and maps it
to `#16171d`. The old warm grey keeps its hue and turns brown. The card's white
maps to `#191927`, as in the reported screenshot. The authored dark panel stays
unchanged. No product theme token changes.

A base anchor rule sets the link colour explicitly, including visited links
and client-created links that inherit the email stylesheet. The button has its
own text colour rule. The existing dark class rules still override both. Proton
can still choose its own accessible link hue. The goal is readable links, not
an exact brand colour after a client transform. Its
[base link CSS](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/colors.css)
and [foreground contrast check](https://github.com/ProtonMail/clients/blob/2ecb794dbc221384dc6d88840965ac144db301ad/project/mail/rust/mail/mail-html-transformer/src/transforms/styles/dark_mode_visitor/declaration_block.rs)
explain this limit.

Keep both `color-scheme: light dark` metadata entries, the root properties,
media queries, CID logos, Outlook selectors and VML. These metadata entries
already existed. They support authored dark rendering, including
[WebKit dark mode](https://webkit.org/blog/8840/dark-mode-support-in-webkit/),
but do not disable Proton's transform.

## Checks

The regression model covers opaque hex colours from the template. Known cases
come from Proton's published colour tests. It checks button text, the button
boundary, links and the neutral panel. It also checks a full RGB inversion.
The forced-dark browser renders apply this colour model to the light layout.
They are simulations, not screenshots from Proton. They do not emulate the
whole SDK CSS cascade, WebView, link detection, VML or image policy.

Before release, check a verification and password reset email in Proton iOS,
Android and web, Gmail, Outlook and Apple Mail, in light and dark:

1. The button boundary and label are visible. The whole button opens the right link.
2. The panel is neutral and its text is readable.
3. Links remain readable before and after a visit.
4. The logo and wordmark are visible. Long links do not cause horizontal scroll.
5. In Outlook desktop, the VML button has a visible boundary and no extra block.

## Cloud mirror follow-up

Do not change cloud from this core task. In `packages/mail`, apply the same
renderer changes as `apps/server/src/auth/email-template.ts`:

1. Add `color:#1a63c4!important` to the base `a` rule. Add the base
   `.button-link{color:#ffffff!important}` rule before the dark rules.
2. Change the HTML button padding to `10px 20px` and add
   `border:2px solid currentColor`.
3. Change VML `stroke="f"` to
   `stroke="t" strokecolor="#ffffff" strokeweight="2px"`.
4. Change both the light panel `bgcolor` and inline `background-color` from the
   light `surfaceHover` token to the light `surface` token. Keep the dark rule.
5. Keep the metadata, dark selectors, CID images, VML ghost table and text
   alternative unchanged. Copy the renderer regression coverage, regenerate
   cloud HTML goldens and run the existing drift check against this core change.

No message copy, URL, mail configuration, attachment or plain-text change is
needed. Update the cloud drift reference by its existing workflow when the
core fix is merged.
