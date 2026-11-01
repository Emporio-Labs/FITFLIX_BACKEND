# Fitflix Public Marketing Data Extraction & Audit Report

> **Audit Date:** 2026-10-28  
> **Target:** Knowledge Base for Fitflix Marketing and Services RAG Chatbot  
> **Scope:** Multi-repository inspection across [USER-APP-FITFLIX](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX), [FITFLIX_BACKEND](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND), and [frontdesk-fitflix](file:///c:/Users/Yeshwanth/Yugaas/github_clones/frontdesk-fitflix)  
> **Extraction Boundary:** Publicly accessible, unauthenticated content only  
> **Code Modification Status:** **Zero code modifications** (Strict read-only inspection)  

---

## 1. Executive Summary

A comprehensive, non-intrusive extraction was conducted across the Fitflix Flutter mobile application, Express/MongoDB backend APIs, and admin reference documents. 

All public-facing information — including brand value propositions, sanctuary branch locations, operating hours, facilities, recovery modalities, athletic pursuits, precision nutrition guidelines, clinical DNA testing protocols, coaching roster mechanics, membership architecture, and official FAQs — was systematically extracted, cross-verified, and formatted into two retrieval-ready deliverables:
1. [`fitflix_public_marketing_data.json`](./fitflix_public_marketing_data.json): 24 structured, machine-readable entries following the 11-field specification.
2. [`fitflix_public_marketing_data.md`](./fitflix_public_marketing_data.md): Semantically organized, human-readable markdown knowledge base tailored for RAG chunking and vector indexing.

---

## 2. Pages, Components & Endpoints Inspected

### A. Mobile Application ([USER-APP-FITFLIX](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX))

| File / Component | Type | Public Content Extracted |
|---|---|---|
| [`lib/screens/public/landing_screen.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/landing_screen.dart) | Screen | Hero banner, value proposition, consultation CTA (`_kConsultInterest`), Instagram social link (`@fitflix_sainikpuri`), and callback modal integration. |
| [`lib/screens/public/landing/sections.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/landing/sections.dart) | Part File | • `_FreeTierBlock`: Free account offerings (Millions to Meditate, Workout tracker, Nutrition tracker).<br>• `_TrustStatsStrip`: Key proof metrics (5+ recovery therapies, DNA plans, 1:1 care team).<br>• `_OfferingsGrid`: Core product categories.<br>• `_ClubSpotlight`: Hyderabad wellness club highlight.<br>• `_MethodSection`: 3-phase Fitflix methodology (Assess, Optimize, Perform).<br>• `_kModalities`: 5 core modalities (Cold, Heat, Light, Recovery, DNA).<br>• `_HomeBundleCard`: Bring It Home recovery equipment bundles.<br>• `_kFaqs`: 5 canonical objection-handling Q&As.<br>• `_LandingFooter`: Slogan ("Performance, engineered."), branch territories, and footer links. |
| [`lib/models/sanctuary_data.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/models/sanctuary_data.dart) | Data Model | Static catalog of all three sanctuaries (Foundry Sainikpuri, Lumina Marathahalli, Iron Oak Electronic City) with full addresses, descriptions, full facilities lists, architectural highlights, and exact opening hours. |
| [`lib/screens/public/public_coaches_screen.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/public_coaches_screen.dart) | Screen | Unauthenticated coach directory (`ptTrainersProvider` -> `/trainers/public`) surfacing active coaches, portraits, specializations, and coaching bios. |
| [`lib/screens/public/public_dna_page.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/public_dna_page.dart) | Screen | 4-step saliva testing protocol, analyzed traits (caffeine metabolism, tendon load, muscle fiber distribution), CLIA lab partnership, and privacy guarantees. |
| [`lib/screens/public/public_nutrition_preview_screen.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/public_nutrition_preview_screen.dart) | Screen | Precision nutrition methodology, master 2,500 kcal baseline, MUST-Salad rule, 4 tsp visible oil allocation, meal slot tracking, and hydration targets. |
| [`lib/screens/public/public_therapy_details_pages.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/public_therapy_details_pages.dart) | Screen | Clinical purpose, session durations, and benefits for recovery therapies (Cryotherapy, Cold Plunge, HBOT, Red Light Sauna). |
| [`lib/data/repository/therapy_repository.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/data/repository/therapy_repository.dart) | Repository | Hardcoded fallback therapy definitions, temperatures (8°C–15°C cold plunge, -110°C cryotherapy), durations, and default credit costs. |
| [`lib/screens/public/pursuit_absolute_strength_screen.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/pursuit_absolute_strength_screen.dart) | Screen | Pursuit 03: Ethos, six disciplines (Olympic lifting, powerlifting, hypertrophy, kettlebells, strongman, calisthenics), and 1:1 coaching. |
| [`lib/screens/public/pursuit_longevity_vitality_screen.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/pursuit_longevity_vitality_screen.dart) | Screen | Pursuit 01: Recovery philosophy, 75-minute signature compounding recovery ritual, and Longevity Lab (IV & peptide therapy). |
| [`lib/screens/public/pursuit_cognitive_clarity_screen.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/screens/public/pursuit_cognitive_clarity_screen.dart) | Screen | Pursuit 02: Mind-body practices, 4 pranayama protocols (Nadi Shodhana, Bhramari, Ujjayi, Sitali), and clinical outcomes (41% back stiffness reduction). |
| [`lib/widgets/callback/request_callback_sheet.dart`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/widgets/callback/request_callback_sheet.dart) | Component | Frictionless lead capture modal requesting phone number and tagging interest surface. |

---

### B. Backend Services & Data Schemas ([FITFLIX_BACKEND](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND))

| Endpoint / File | Auth Requirement | Extracted Data |
|---|---|---|
| `GET /membership-plans` ([`membershipPlan.routes.ts`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND/src/routes/membershipPlan.routes.ts)) | **Public (None)** | Plan category enums (`GENERAL_MEMBERSHIP`, `PERSONAL_TRAINING`, `THERAPY_PACK`, `CREDIT_PACK`), currency (`INR`), GST rate (18%, SAC 999723), duration fields, and founding membership flags. |
| `GET /trainers/public` ([`trainer.routes.ts`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND/src/routes/trainer.routes.ts)) | **Public (None)** | Pre-login trainer roster API, exposing `trainerName`, `description`, `specialities`, `imageUrl`, and `keySentence`. |
| `GET /therapies/public` ([`therapy.routes.ts`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND/src/routes/therapy.routes.ts)) | **Public (None)** | Pre-login recovery catalog exposing `serviceName`, `serviceTime`, `description`, `tags`, and availability status. |
| `GET /promotions/public` ([`promotion.routes.ts`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND/src/routes/promotion.routes.ts)) | **Public (None)** | Public promotional campaigns explicitly filtered for `audience: "non_member"`. |
| `POST /leads/public-capture` ([`lead.routes.ts`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND/src/routes/lead.routes.ts)) | **Public (Rate-limited)** | Public lead generation interface capturing mobile number, interest tag, and referring app screen. |
| [`scripts/seed-locations.ts`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND/scripts/seed-locations.ts) | Seed Script | Primary branch headquarters verification: address, phone (`+91 91234 56789`), email (`sainikpuri@fitflix.in`), and operational settings. |

---

## 3. Categorization & Distribution of Extracted Data

The 24 extracted items in [`fitflix_public_marketing_data.json`](./fitflix_public_marketing_data.json) span the following domains:

| Category | Item Count | Key Highlights Captured |
|---|:---:|---|
| `brand_information` | 3 | Core positioning, slogan, trust stats, 3-phase Fitflix Method. |
| `branches` | 4 | Hyderabad Wellness Club overview + 3 physical sanctuaries with addresses, hours, and equipment inventories. |
| `services` | 7 | Cold Plunge, Cryotherapy (-110°C), HBOT, Red Light Sauna, Infrared Sauna, NormaTec Compression, Home Hardware Bundles. |
| `fitness_programs` | 3 | Pursuit 01 (Longevity & Vitality), Pursuit 02 (Cognitive Clarity), Pursuit 03 (Absolute Strength). |
| `group_classes` | 1 | Class formats (Yoga, Dance Fit, Pilates, Cardio HIIT, S&C), studio capacity, and app live streaming. |
| `nutrition_services` | 1 | Precision nutrition coaching, master 2,500 kcal baseline, MUST-Salad rule, 4 tsp visible oil, in-app trackers. |
| `trainers` | 1 | Public coaching roster, certification standards, multidisciplinary team (physicians, physios, dietitians, coaches). |
| `membership_plans` | 2 | Free Account Tier (INR 0) + Paid Membership Architecture (4 plan categories, 18% GST SAC 999723, multi-gym access). |
| `faqs` | 5 | Official objection handling (DNA privacy, consultation structure, beginner suitability, multi-gym access, travel flexibility). |
| `promotions` | 1 | Pre-login promo carousel and zero-friction callback lead capture mechanics. |

---

## 4. Verification & Consistency Audit

### Confirmed Information
- **Branch Locations & Addresses:** Confirmed across both the Flutter [SanctuaryCatalog](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/models/sanctuary_data.dart) and backend [seed-locations.ts](file:///c:/Users/Yeshwanth/Yugaas/github_clones/FITFLIX_BACKEND/scripts/seed-locations.ts). The addresses, operating schedules, and facilities for Sainikpuri, Marathahalli, and Electronic City are consistent.
- **Multi-Gym Access Policy:** Confirmed in `_kFaqs[3]`: Every membership is valid at all three gyms across Hyderabad and Bengaluru.
- **Hyderabad Wellness Club Exclusivity:** Confirmed in `_ClubSpotlight` and `_kFaqs[3]`: While gym workout access spans all locations, the dedicated wellness recovery suite (cryotherapy chamber, full clinical lab) is physically exclusive to the Hyderabad flagship.
- **Free Account Features:** Confirmed in `_FreeTierBlock`: Registering an account costs nothing and unlocks morning guided meditation, the workout logger, and the nutrition/barcode tracker.
- **DNA Privacy & Lab Protocols:** Confirmed across `public_dna_page.dart` and `_kFaqs[0]`: Testing is conducted with a CLIA-certified partner laboratory; data is strictly encrypted and deletable upon request.
- **Credit Value Baselines:** Confirmed in `therapy_repository.dart`: Fallback values reflect 10 credits for Cold Plunge (20 min), 5 credits for Cryotherapy (3 min), 1 credit for HBOT (60 min), and 20 credits for Red Light Sauna (20 min).

### Ambiguities & Discrepancies Documented
1. **Fixed Retail Price Disclosure vs. Consultation Sales Model:**
   - *Observation:* The public frontend does not display static INR price cards for standard quarterly or annual memberships. 
   - *Reason:* Fitflix deliberately employs an assessment-first, consultative sales motion. Memberships are customized based on personal training frequency, recovery credit allocations, and founding discounts during a mandatory 45-minute private consultation.
   - *Resolution for RAG:* The RAG chatbot must inform prospective users that basic digital accounts are free (INR 0), while membership packages are tailored and quoted during the complimentary 45-minute consultation.
2. **Promotional Banner Content:**
   - *Observation:* The pre-auth promotional carousel ([`PromoCarousel.public`](file:///c:/Users/Yeshwanth/Yugaas/github_clones/USER-APP-FITFLIX/lib/widgets/promo_carousel.dart)) dynamically queries `GET /promotions/public?audience=non_member`. When no active campaigns exist in the database, the widget renders zero height rather than placeholder text.
   - *Resolution for RAG:* The chatbot should present the standard consultation and founding member opportunities rather than assuming fixed promotional discounts.
3. **Imagery and Video Reels:**
   - *Observation:* Some imagery in pursuit screens and reel cards uses high-resolution Unsplash biotech/athletic stock assets marked as placeholders awaiting the brand photography shoot.
   - *Resolution for RAG:* Textual descriptions and clinical claims were extracted; aesthetic placeholder image references were noted.

---

## 5. Security & Authentication Boundaries Verified

- **Zero Auth Bypass:** No authenticated endpoints (such as `/users`, `/bookings`, `/credits`, `/invoices`, or `/schedules`) were invoked or extracted.
- **No Personal Member Data:** Extracted data contains zero personal information, private user telemetry, or health marker uploads.
- **Public Surface Compliance:** Only public mobile screens, public routes (`/trainers/public`, `/therapies/public`, `/membership-plans`, `/promotions/public`), and static catalog definitions were utilized.

---

## 6. Conclusion & Readiness for RAG Pipeline

The public knowledge base for Fitflix is complete, verified against the source code, and structured for vector ingestion:
- Use [`fitflix_public_marketing_data.json`](./fitflix_public_marketing_data.json) for programmatic chunking, embedding generation, or database seeding.
- Use [`fitflix_public_marketing_data.md`](./fitflix_public_marketing_data.md) as the canonical documentation reference and semantic chunk source.
