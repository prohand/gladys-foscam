# Security policy

## Supported versions

Only the latest release of the Foscam integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-foscam](https://github.com/prohand/gladys-foscam/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys, and the camera model and firmware;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove passwords, tokens and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes — for
example a camera password leaking into the logs, the device params or `/data`, or a
camera address that reaches something other than the camera.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), and the
Foscam cameras, their firmware and their cloud (report to Foscam).

## What the integration does with your credentials

- The Foscam CGI API takes the username and password in the query string of every
  request, over plain HTTP, on your local network. This is how the camera works,
  not a choice of the integration: use a **dedicated camera user**, with the least
  role it needs (operator; administrator only to switch the motion detection or the
  night vision from Gladys).
- The password lives in the Gladys secret field. The integration never writes it to
  its logs, its error messages, the Gladys devices or its own file in `/data` (which
  only keeps each camera's MAC address, model and presets).
- After a wrong password, the integration stops asking that camera for five minutes,
  so that it does not get the account locked.

## Good practices for users

- Keep the cameras on a network you trust, and **never expose them to the internet**
  (port forwarding, UPnP). Turn UPnP and P2P off in the camera if you do not use the
  Foscam app.
- Keep Gladys, the integration and the camera firmware up to date.
