# ZFREIGHT_REV — Revision header: FM + SEGW spec

Companion to `ZFREIGHT_SRV_SRV` / `Freight` (`FreightSet`). Adds the missing
header entity so a revision can be created in SAP before lines are posted
against it. Mapped to exactly what the freight portal's approval workflow
needs — see `server/routes/revisions.js` and `server/seedData.js` in the
repo for the shape this mirrors.

Design choice: the Revision header is created **once, at approval time**
(the same moment Freight lines are written), already fully formed —
diesel price, effective date, submitter, approver. Not a multi-state
draft that gets updated later. That matches the three FMs below (no
UPDATE) and keeps SAP holding a record of *released* revisions only —
the pending/submit/reject/return workflow stays local to the portal,
same as it does today for vendor/rate-sheet data.

## Entity type: `Revision`

| Field | Type | Notes |
|---|---|---|
| `RevisionId` | `NUMC 10` | Key. Same number range as `ZFREIGHT.RevisionId` — a Freight line's `RevisionId` should always resolve to a `Revision` row. SAP-assigned (creatable=false), like `Freight`'s key. |
| `NewPrice` | `CURR 13,2` | This revision's diesel price (was `NEW_PRICE_ID` on `ZFREIGHT_REV` — recommend renaming if there's no existing consumer depending on the old name). |
| `OldPrice` | `CURR 13,2` | The diesel price the previous revision was based on (was `OLD_PRICE_ID`). |
| `DieselEffectiveDate` | `Edm.DateTime` | When the diesel price itself took effect. |
| `EffectiveDate` | `Edm.DateTime` | When the revised rates take effect (drives `Freight.EffectiveDate`/`ValidFrom` for lines under this revision). |
| `FuelType` | `CHAR 40` | e.g. "High Speed Diesel". |
| `Source` | `CHAR 40` | e.g. "PSO". |
| `NotificationFileName` | `CHAR 100` | Optional — name of the attached diesel-price notification, if any. |
| `Remarks` | `CHAR 255` | Optional. |
| `OverallUpliftPct` | `DEC 13,4` | `(NewPrice - OldPrice) / OldPrice * 100`, kept for audit rather than recomputed. |
| `SubmittedByEmployeeId` | `CHAR 12` | Rate maintainer. |
| `SubmittedByName` | `CHAR 40` | |
| `SubmittedOn` | `Edm.DateTime` | |
| `ApprovedByEmployeeId` | `CHAR 12` | Approver — never equal to `SubmittedByEmployeeId` (already enforced app-side, safe to also enforce here). |
| `ApprovedByName` | `CHAR 40` | |
| `ApprovedOn` | `Edm.DateTime` | |
| `CreatedBy` / `CreatedAt` | audit | SAP-assigned, same convention as `Freight`. |

Navigation (optional, nice-to-have): a `1:N` association `Revision` →
`Freight` on `RevisionId`, so `RevisionSet('0000000023')/Freight` returns
that revision's lines in one call instead of a separate `$filter`.

## FM 1 — `Z_FREIGHT_REV_GET_LIST`

Backs `GET RevisionSet`.

```
IMPORTING
  I_STATUS_FILTER   TYPE CHAR10 OPTIONAL   " leave blank for "no filter" — no server-side status concept beyond what's stored
EXPORTING
  ET_REVISIONS      TYPE TT_ZFREIGHT_REV   " table of the Revision structure above, newest RevisionId first
```

## FM 2 — `Z_FREIGHT_REV_GET_DETAIL`

Backs `GET RevisionSet('...')`.

```
IMPORTING
  I_REVISION_ID     TYPE ZFREIGHT_REV-REVISION_ID
EXPORTING
  ES_REVISION       TYPE ZFREIGHT_REV       " single row
  E_TYPE            TYPE C                  " 'S' | 'E'
  E_MESSAGE         TYPE STRING             " e.g. "Revision 0000000099 does not exist" — same convention as Freight's errors
```

## FM 3 — `Z_FREIGHT_REV_CREATE`

Backs `POST RevisionSet`. Assigns `RevisionId` from the same number range
`Freight.RevisionId` draws from (or shares one) — this is the piece that
was missing, since `Freight`'s own `CREATE_ENTITY` validates against an
already-existing `RevisionId` and has no way to mint one itself.

```
IMPORTING
  I_NEW_PRICE                TYPE ZFREIGHT_REV-NEW_PRICE_ID
  I_OLD_PRICE                TYPE ZFREIGHT_REV-OLD_PRICE_ID
  I_DIESEL_EFFECTIVE_DATE    TYPE D
  I_EFFECTIVE_DATE           TYPE D
  I_FUEL_TYPE                TYPE CHAR40
  I_SOURCE                   TYPE CHAR40
  I_NOTIFICATION_FILE_NAME   TYPE CHAR100 OPTIONAL
  I_REMARKS                  TYPE CHAR255 OPTIONAL
  I_OVERALL_UPLIFT_PCT       TYPE P DECIMALS 4
  I_SUBMITTED_BY_EMP_ID      TYPE CHAR12
  I_SUBMITTED_BY_NAME        TYPE CHAR40
  I_SUBMITTED_ON             TYPE D
  I_APPROVED_BY_EMP_ID       TYPE CHAR12
  I_APPROVED_BY_NAME         TYPE CHAR40
  I_APPROVED_ON              TYPE D
EXPORTING
  E_REVISION_ID              TYPE ZFREIGHT_REV-REVISION_ID   " newly assigned — the app then uses this as the RevisionId on every Freight line it creates for this revision
  E_TYPE                     TYPE C
  E_MESSAGE                  TYPE STRING
```

## SEGW mapping

Same project as `Freight`/`FreightSet`. Import all three FMs via
"Import" → "Create via Wizard" (same flow already used for `Freight`),
entity type `Revision`, entity set `RevisionSet`:

- `GET_LIST` → Query operation
- `GET_DETAIL` → Read operation
- `CREATE` → Create operation

Generate + register the service (same `/sap/opu/odata/sap/ZFREIGHT_SRV_SRV/`
service, so it reaches the app through the same APIM proxy at
`https://devspace.test.apimanagement.eu10.hana.ondemand.com/freight` with
no new proxy config needed) and it's ready to test the same way `Freight`
was — a plain `GET .../RevisionSet` first, before any create.

## Once this is live

The app-side change is small and contained: `server/routes/revisions.js`'s
approve handler creates the `Revision` row first (`POST RevisionSet`),
reads back `E_REVISION_ID`, uses that as the `RevisionId` on every
`Freight` line it then creates — replacing the local revision counter as
the authoritative source. I'll wire it the same tested way as `Freight`:
a live read/write check against dev with real credentials before trusting
it, same process as this round.
