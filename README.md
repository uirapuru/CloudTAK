> **taklab fork.** This is a modified version of CloudTAK v13.3.0 used by taklab (branch `taklab/v13.3.0`), published under the AGPL-3.0 as required. Changes: the sender UID is sent with live chat messages (backport of dfpc-coe/CloudTAK#1290, Bug 2), a paperclip button in one-to-one chats attaches a map snapshot (`y-taklab-map` CoT event) for the ai-buddy chat bot, and 3D buildings from Cesium ion as map overlays (routes `/api/ion` and `/api/ion/:name/endpoint`, admin config key `ion::token` with env var fallback `CESIUM_ION_TOKEN`, overlay type `3dtiles` rendered via deck.gl; terrain must be configured for correct footprint placement).

<p align=center><img src='./api/web/public/CloudTAKLogo.svg' alt='CloudTAK Logo' width='128'/></p>

<h1 align=center>CloudTAK</h1>

<p align=center>Full Featured in-browser TAK Client</p>
<p align=center>&</p>
<p align=center>Facilitate ETL operations to bring non-TAK data sources into a TAK Server</p>

<p align='center'>
    <a href="https://codecov.io/gh/dfpc-coe/CloudTAK" >
        <img src="https://codecov.io/github/dfpc-coe/CloudTAK/graph/badge.svg?token=O9PK0XT9Z2"/>
    </a>
</p>

<img src='./docs/Screenshot.png' alt='Screenshot of CloudTAK'/>

## Documentation

Deployment, local development, and administration guidance now live in the CloudTAK documentation site so the repo root is not a second source of truth.

- Deployment: https://docs.cloudtak.io/deploy/
- Local development: https://docs.cloudtak.io/develop/
- Administration: https://docs.cloudtak.io/admin/

> [!NOTE]
> Local development and Docker Compose expose the core map experience, but a full AWS deployment is still required for the complete optional ETL infrastructure.


