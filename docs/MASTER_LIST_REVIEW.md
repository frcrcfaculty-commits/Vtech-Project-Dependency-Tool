# Master list cleanup — APPROVED by VTech on 2026-10-28

All changes below, the interpretations of the vague rows, and the 9 additions from the Specimen were approved.
All 78 items are active.

Source: Google Sheet "Vtech Project Dependency" → Dependency tab (70 rows). Full mapping, row by row, is in
`supabase/seed/master_dependencies.csv` (column `original_text` keeps the sheet's wording).

## What changed
1. **Spelling and wording fixed** throughout (posioton, Configration, Coolmsater, instyalled, Amplfiier, Autoamtion, Hone → Home…). All items phrased as the pending condition.
2. **Agency names unified**: Carpentar → Carpenter; "Network agency" / "Netwrok Agency" → Network Agency; "AV vendor" / "AV Vendor" → AV Vendor; "Vtech" → VTech.
3. **Duplicate merged**: "AV Configration not done yet" and the separate "AV Configration" row → one item. 70 → 69 active items.
4. **Split owners resolved** (each item has one owner; the PM can change the agency per project):
   - "Curtain Vendor / Vtech" – Curtain motor installation → **Curtain Vendor**
   - "Architect / Client" – curtain opening position, light looping, scene requirements → **Architect** (new agency type)
5. **Vague rows interpreted — please confirm:**
   | Sheet | Now | Question |
   |---|---|---|
   | Electrician: "CCTV Video door Phone" | CCTV / video door phone cable not at its position. | Is it the cabling? |
   | Carpenter: "VDV," | VDP (video door phone) cutout not done. | Is VDV = VDP? |
   | Carpenter: "Door lock" | Door lock cutout not done. | Correct? |
   | Painter: "DB room / wall / ceiling yet not complete." | DB room wall/ceiling work not complete. | OK? |
   | VTech: "Lights Details" / "Curtain Detail" / "Fan Details" | Lighting / curtain / fan details pending. | Details needed *from* whom? |

## Additions from the Specimen tab (approved, active)
These appear in the real 12th–14th floor project but are not in the master list:
- Electrician: Face reader installation pending · On/off lights installation pending · Cove light DALI connection pending
- Carpenter: Door magnet cutout pending
- Curtain Vendor: Roller blind fabric installation pending
- VTech: Curtain motor limit setting pending · New light programming pending · AC addressing pending
- Wallpaper Vendor (new agency type): Wall finish not complete — blocks face reader/eKey installation

