# ABMI Human Footprint Inventory and AER well and pipeline data: content and terms (2026)
- **Source:**
  - Alberta Biodiversity Monitoring Institute, *Wall-to-Wall Human Footprint Inventory – Year 2023* (data portal 86, DOI 10.60759/data-86): https://abmi.ca/data-portal/86.html
  - ABMI, Human Footprint Mapping page: https://abmi.ca/abmi-home/what-we-do/land-cover-and-land-use-mapping/human-footprint-mapping.html
  - ABMI, Terms and Conditions: https://abmi.ca/abmi-home/terms-and-conditions
  - ABMI, *Seismic Snapshot: Upcoming Changes to the Human Footprint Inventory* (2026): https://abmi.ca/publication/684.html
  - Government of Alberta, Alberta Human Footprint Monitoring Program: https://www.alberta.ca/alberta-human-footprint-monitoring-program
  - ABMI human footprint report for the Foothills Natural Region, 2023 and 2026 editions: https://archive.abmi.ca/home/reports/2023/human-footprint/details.html?id=11 and https://archive.abmi.ca/home/reports/2026/human-footprint/details.html?id=11
  - AER Product Catalogue, ST37 List of Wells: https://www1.aer.ca/ProductCatalogue/10.html
  - AER Product Catalogue, Enhanced Pipeline Graphics File: https://www1.aer.ca/ProductCatalogue/557.html
- **Read:** 2026-10-17. I read the agency pages for the ABMI data portal, mapping page, terms, Alberta.ca and the AER catalogue. The ABMI Foothills report pages, the HFI 2023 metadata PDF and the Seismic Snapshot PDF did not open (connection refused or timed out on archive.abmi.ca and ftp-public.abmi.ca). **The Foothills statistics below come from search-result summaries only.**
- **Evidence:** [G] for data content and terms. [S] for the ABMI statistics, at snippet level.
- **Where and when:** all of Alberta. HFI 2023 was last modified 2026-10-15. The Foothills Natural Region covers 66,437 km² (snippet).

## Extracted facts
- **HFI 2023 dataset page:**
  - "A comprehensive digital representation of anthropogenic disturbances (e.g., agriculture, forestry, energy) on the Alberta land-base, digitized manually, as seen from SPOT6 satellite imagery. This includes linear features."
  - "The 2023 Human Footprint Inventory includes updated classification and dating of the 'seismic lines, trails, and other linear features' layer."
  - The zip is 4.5 GB. Last modified Oct 15, 2026. "Data provided by: ABMI Geospatial Centre, Government of Alberta."
- **The Seismic Snapshot (2026) says:** "In the 2023 Human Footprint Inventory (HFI), users will have access to the most accurate classification and dating of seismic lines ever available to the public." The PDF itself was unreadable.
- **The ABMI mapping page says:**
  - "The current Human Footprint Inventory contains 117 feature types and 20 individual sublayers including seismic lines, harvest areas, roads, and pipelines."
  - The inventory "dates back to 2000 and is now updated annually".
  - Footprint "includes land that is periodically reset to earlier successional conditions by industrial activities such as forestry cutblocks and seismic lines".
  - It adds: "Some human land uses, such as grazing, hunting, and trapping, are not yet accounted for".
- **Alberta.ca says:** "Over 30% of Alberta's land surface has human footprint." The HFI is "available on ABMI's website as open and free datasets for download". No licence is named.
- **ABMI terms:** "Use of ABMI Information Products requires that the ABMI be acknowledged as the source of information." I found no Creative Commons, open-licence or commercial-use clause. The website licence is "limited, gratuitous and revocable".
- **Foothills Natural Region statistics (search snippets, not verified on the page):**
  - **c. 2021 edition:**
    - Total human footprint 33.6%: forestry 24.3%, agriculture 3.3%, energy 3.0%, transportation 2.0%.
    - The total rose from 19.4% in 2000. Forestry falls to 17.9% if regeneration is counted.
    - Linear feature density 4.2 km/km²: conventional seismic 2.7, roads 0.8, pipelines 0.7. Low-impact seismic is excluded.
  - **2026 edition (c. 2023):**
    - Forestry 25.7%, energy 3.2%, transportation 2.1%. Total footprint 23,366 km² of 66,437 km²; the search tool worked that out as about 35%.
    - Linear density: seismic 2.0, roads 0.8, other linear 0.7 km/km².
- **AER ST37 (wells):**
  - Free self-serve zip in Excel, Shapefile or Geodatabase; "Monthly"; includes bottom holes, surface holes and well geometry.
  - Terms: "protected by copyright and are provided for informational purposes only"; "No unauthorized commercial reproduction or exploitation is allowed."
- **AER Enhanced Pipeline:**
  - "This dataset contains all AER-approved oil and gas pipelines in Alberta". It excludes low-pressure distribution lines.
  - Free self-serve SHP/CSV; listed as "Daily". Same copyright and "no unauthorized commercial reproduction" wording.

## What it means for Clearwater
- [I] **The HFI is the open source that splits what Base Features lumps together.** Base Features has one "CUTLINE-TRAIL" class. The HFI separates conventional and low-impact seismic, pipelines, trails, well sites and cutblocks, and the 2023 edition dates them. That is what the predator-lane and OHV-route questions need: conventional seismic and pipelines speed wolves, low-impact lines do not (Dickie 2017).
- [I] **The box is a typical foothills landscape.** My measured roads plus cutline-trails come to 1.04 + 3.58 ≈ 4.6 km/km², against 4.2 km/km² for the whole Foothills region c. 2021 (snippet).
- [I] **Licensing for the paid tier:**
  - OGL–Alberta roads are clean.
  - ABMI asks only for acknowledgement but grants no explicit commercial licence.
  - AER forbids "unauthorized commercial reproduction".
  - Before shipping HFI or AER geometry inside paid HD packs, get written terms. Deriving a score without redistributing geometry may be treated differently; that is a legal question, not answered here.

## Not confirmed
- The ABMI Foothills percentages and densities above. The pages were unreachable, so they are snippet only.
- The HFI 2023 licence wording in its metadata PDF (unreachable).
- The claim that Alberta has "the highest linear-feature densities in Canada/the world". I read no source that states it with numbers.
- The search snippet ">200,000 km of unmapped linear features in Alberta" (ABMI). Not read at source.
- Pipeline length in the box. I did not download the province-wide AER pipeline file.
