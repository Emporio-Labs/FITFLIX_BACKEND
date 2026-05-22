# Fitflix User App — Nutrition Module Implementation Guide

> **Audience:** Frontend developers building the Nutrition tab in the Fitflix User App.
> **Scope:** USER APP nutrition screens only — post-onboarding.
> **Architecture:** Dashboard-first mobile experience. The Nutrition Dashboard is the control center. All detail screens are secondary and accessed via card interactions inside the dashboard.
> **Status:** Production specification — UI, UX, navigation, data flow, and integration behavior.

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [App Navigation — Adding the Nutrition Tab](#2-app-navigation--adding-the-nutrition-tab)
3. [Real Mobile User Flow](#3-real-mobile-user-flow)
4. [Nutrition Dashboard Screen — The Control Center](#4-nutrition-dashboard-screen--the-control-center)
5. [Meal Plan Screen (Secondary)](#5-meal-plan-screen-secondary)
6. [Meal Tracking Screen (Secondary)](#6-meal-tracking-screen-secondary)
7. [Progress Screen (Secondary)](#7-progress-screen-secondary)
8. [Coach Notes Screen (Secondary)](#8-coach-notes-screen-secondary)
9. [Realtime Update Flow](#9-realtime-update-flow)
10. [API Integration Expectations](#10-api-integration-expectations)
11. [Recommended State Management](#11-recommended-state-management)
12. [UX Recommendations](#12-ux-recommendations)
13. [Future Enhancements](#13-future-enhancements)
14. [Final Recommended Folder Structure](#14-final-recommended-folder-structure)

---

## 1. Module Overview

The **Nutrition Module** is a new tab added to the existing Fitflix bottom navigation. It becomes the user's **daily nutrition companion** after onboarding is complete.

### Purpose

- Deliver the nutritionist's daily plan directly to the user in a realtime, mobile-native experience.
- Act as a **guidance-first, adherence-first** dashboard — not an appointment portal.
- Reflect nutritionist updates the moment they are published.
- Keep the user focused on: *"What do I eat today, and how am I doing?"*

### Product Feeling

The user should feel:

> *"My nutrition coach updates my daily guidance here."*

Not:

> *"I am managing consultations and appointments."*

### Architecture in One Sentence

The **Nutrition Dashboard is the control center.** Every other screen in this module is a secondary detail screen opened by tapping a card or action inside the dashboard.

---

## 2. App Navigation — Adding the Nutrition Tab

### Existing Bottom Navigation

The Fitflix app already has an established bottom navigation. **Do not redesign it.** Only add the new Nutrition tab at the correct position.

```
Current:
┌──────┬───────────┬──────────┬─────┬──────────┬─────────┐
│ Home │ Therapies │ Exercise │ DNA │ Sessions │ History │
└──────┴───────────┴──────────┴─────┴──────────┴─────────┘

After adding Nutrition:
┌──────┬───────────┬──────────┬───────────┬─────┬──────────┬─────────┐
│ Home │ Therapies │ Exercise │ Nutrition │ DNA │ Sessions │ History │
└──────┴───────────┴──────────┴───────────┴─────┴──────────┴─────────┘
```

**Placement:** Nutrition tab sits immediately to the right of Exercise and to the left of DNA.

### Implementation Notes

- Add Nutrition icon + label to the existing `BottomNavigationBar` widget (Flutter) or tab bar component (React Native).
- The tab is only active and navigable after `user.onboarded = true`. If a user who has not completed onboarding somehow reaches this tab, show a friendly locked state: *"Complete your health profile to unlock nutrition guidance."*
- The Nutrition tab root route always opens the **Nutrition Dashboard** screen. There is no sub-navigation bar inside the Nutrition tab.

---

## 3. Real Mobile User Flow

### How Users Actually Navigate This Module

This is a **dashboard-driven, tap-to-explore** mobile experience. Users do not move through screens linearly. They land on the dashboard and interact with whatever is most relevant to them in that moment.

```
User opens app
        │
        ▼
Home Screen
        │
        └── Taps Nutrition tab in bottom nav
                        │
                        ▼
             ┌──────────────────────────┐
             │    Nutrition Dashboard   │  ← PRIMARY SCREEN
             │     (Control Center)     │
             └──────────┬───────────────┘
                        │
        ┌───────────────┼────────────────────────────┐
        │               │                │           │
        ▼               ▼                ▼           ▼
  Meal Plan         Tracking          Progress   Coach Notes
  Screen            Screen            Screen     Screen
  (Secondary)       (Secondary)       (Secondary)(Secondary)
```

### Entry Point: Every Time

The user always lands on the **Nutrition Dashboard** when they tap the Nutrition tab — regardless of where they were when they last left the app. There is no deep-link default into any secondary screen.

### Navigation Direction

- **Dashboard → Secondary screen:** User taps a card or CTA inside the dashboard.
- **Secondary screen → Dashboard:** User taps the back button or swipes back (OS-native).
- **Secondary screen → different secondary screen:** Not directly — always route back through the dashboard first. Keep navigation shallow.

### Card-Tap Navigation Map

| Dashboard Card | Opens |
|---|---|
| "View Meal Plan" / Today's meals card | Meal Plan Screen |
| "Track Meals" / adherence card | Tracking Screen |
| "View Progress" / weight preview card | Progress Screen |
| Coach note preview card | Coach Notes Screen |
| Hydration tracker | Inline interaction on dashboard (no new screen) |
| Next consultation info | Inline card only (no dedicated screen) |

---

## 4. Nutrition Dashboard Screen — The Control Center

The dashboard is the **entire Nutrition experience** for most users on most days. It must answer in under 3 seconds:

> *"What do I eat today, and how am I doing?"*

This screen scrolls vertically. It is composed of modular cards. Users interact with cards directly or tap them to open detail screens.

### Full Card Layout (Top to Bottom)

```
┌────────────────────────────────────────────┐
│  Header: Greeting + Nutritionist name      │
├────────────────────────────────────────────┤
│  Calorie Summary Ring (large, centered)    │
├────────────────────────────────────────────┤
│  Macros Row  [ Protein ] [ Carbs ] [ Fat ] │
├────────────────────────────────────────────┤
│  Hydration Tracker (tap to add glasses)    │
├────────────────────────────────────────────┤
│  Next / Upcoming Meal Card                 │
│  [ Log This Meal ]  CTA                    │
├────────────────────────────────────────────┤
│  Today's Meals Overview (collapsed list)   │
│  [ View Meal Plan → ]                      │
├────────────────────────────────────────────┤
│  Adherence Score Card                      │
│  [ Track Meals → ]                         │
├────────────────────────────────────────────┤
│  Progress Preview (mini chart + weight)    │
│  [ View Progress → ]                       │
├────────────────────────────────────────────┤
│  Coach Note Card (pinned)                  │
│  [ Read More → ]                           │
├────────────────────────────────────────────┤
│  Next Consultation (small, low-emphasis)   │
│  "Next Nutrition Review — Friday 6:00 PM"  │
└────────────────────────────────────────────┘
```

---

### 4.1 Header

- **Content:** Personalized greeting ("Good morning, Aditya"), current date, nutritionist's name and avatar ("Your coach: Priya N.").
- **Purpose:** Set the coach-relationship tone immediately. Every piece of guidance on this screen is from a human expert.
- **Behavior:** Static — does not tap to anything.

---

### 4.2 Calorie Summary Ring

- **Purpose:** Single most prominent element — shows today's calorie progress at a glance.
- **UI:** Large animated ring/arc, fills as meals are logged. Center shows `consumed kcal / target kcal`. Below the ring: `"420 kcal remaining today"`.
- **Realtime behavior:** If the nutritionist updates the daily calorie target, the ring resizes to the new target on the next fetch. The fill represents only what the user has logged.
- **Components:** Circular progress indicator, large numeric center text, subtle remaining label.

---

### 4.3 Macros Row

- **Purpose:** Quick macro check without opening a detail screen.
- **UI:** Three horizontal pill-shaped progress bars side by side — Protein (blue), Carbs (orange), Fat (yellow). Each shows `Xg / Xg` and a mini progress fill.
- **Realtime behavior:** Targets are nutritionist-authored. Fill advances as the user logs meals.
- **Interaction:** Tapping the macros row does not navigate. It is informational only on the dashboard.

---

### 4.4 Hydration Tracker

- **Purpose:** Track daily water intake against the nutritionist's target.
- **UI:** A row of glass icons (e.g., 8 glasses total). Tapped glasses fill with color. Below: `"5 of 8 glasses"`. A `+ Add Glass` button for quick logging.
- **Interaction:** Tap any glass icon or the `+ Add` button to log one glass. Haptic feedback on tap. No separate screen — this is fully inline on the dashboard.
- **Realtime behavior:** Daily hydration goal can be adjusted by the nutritionist. App reflects the new target on next fetch.

---

### 4.5 Next / Upcoming Meal Card

- **Purpose:** Direct the user to the single most relevant action right now — eating the right thing at the right time.
- **UI:** Prominent card with meal name, eating window (e.g., "Lunch · 1:00 PM – 2:00 PM"), calorie count, and a `Log This Meal` primary CTA button.
- **Interaction:** `Log This Meal` opens a quick-log bottom sheet (not a new screen). After logging, the card automatically advances to the next pending meal.
- **Realtime behavior:** Card content is driven by the nutritionist's plan. If a meal is updated, this card reflects it immediately on the next fetch.

---

### 4.6 Today's Meals Overview

- **Purpose:** Give a compact summary of all meals for the day.
- **UI:** Collapsed list — one row per meal (icon + name + calorie + status chip). Shows Breakfast, Lunch, Dinner, Snacks with a logged/pending/skipped status chip on each.
- **Interaction:** A `View Meal Plan →` link at the bottom of this section navigates to the full **Meal Plan Screen**.
- **Behavior:** Tapping an individual meal row in the overview opens the same quick-log bottom sheet as the next meal card.

---

### 4.7 Adherence Score Card

- **Purpose:** Surface today's adherence to keep the user accountable and motivated.
- **UI:** Score displayed prominently (e.g., `87%`), a streak counter ("5-day streak 🔥"), and a short text ("3 of 4 meals logged today").
- **Interaction:** A `Track Meals →` link navigates to the full **Tracking Screen**.
- **Realtime behavior:** Score recomputes client-side after every log and is reconciled with the backend on each fetch.

---

### 4.8 Progress Preview

- **Purpose:** Show a teaser of the user's progress so they feel momentum.
- **UI:** Mini sparkline chart (weight over 7 days) + latest weight + arrow trend. One line: `"Down 1.2 kg this month"`.
- **Interaction:** A `View Progress →` link navigates to the full **Progress Screen**.
- **Behavior:** Chart data loads lazily — show a skeleton if data isn't ready yet.

---

### 4.9 Coach Note Card (Pinned)

- **Purpose:** Surface the most important message from the nutritionist.
- **UI:** Quote-style card with the nutritionist's avatar, name, a short message preview (2 lines max), and a `Read More →` link.
- **Interaction:** `Read More →` navigates to the full **Coach Notes Screen**.
- **Realtime behavior:** When the nutritionist publishes a new pinned note, a badge appears on this card and on the Nutrition tab icon. Tapping the card clears the badge.
- **Empty state:** If no note has been published yet, hide this card entirely. Do not show a placeholder.

---

### 4.10 Next Consultation Info (Small Card)

- **Purpose:** Inform the user of their next nutrition review — low emphasis, not a primary action.
- **UI:** Small, low-contrast informational card at the bottom of the dashboard scroll. Example: *"Next Nutrition Review — Friday 6:00 PM with Priya N."*
- **Interaction:** Tap opens the meeting link in the device's browser/calendar. No dedicated consultation screen.
- **Design intent:** Consultation was already completed during onboarding. This card is a reminder only — it must not dominate the dashboard.

---

## 5. Meal Plan Screen (Secondary)

> **How to reach:** Tap `View Meal Plan →` on the dashboard's Today's Meals section.

This screen displays the full, nutritionist-authored meal plan. Users can read, log, and explore meals but **cannot edit the plan**.

### Layout

- **Date pill selector** at the top (Today, Tomorrow, scroll to future days).
- **Daily summary banner** — nutritionist's overall note for the day (e.g., "High protein day, light on carbs.").
- **Vertical list of meal cards** in chronological order.

### Meal Types

```
Breakfast
Mid-morning Snack
Lunch
Pre-workout
Post-workout
Dinner
Evening Snack
```

### Meal Card States

| State | Visual |
|---|---|
| Upcoming | Default card, outlined |
| In eating window | Card with accent highlight |
| Logged | Green check, muted card |
| Skipped | Strikethrough label, muted |
| Missed | Red outline, faded |

### Meal Card — Collapsed View

- Meal name and icon
- Eating time window
- Calorie total
- Macro pills: `P 32g · C 45g · F 12g`
- Status chip

### Meal Card — Expanded View (tap to expand)

- Full ingredient list with quantities
- Preparation/cooking notes
- **Substitution options** (nutritionist-approved alternatives)
- Per-ingredient macro breakdown
- **Nutritionist's note** for this meal (e.g., *"Eat slowly. Focus on the protein source first."*)
- `Log This Meal` primary CTA
- `Mark as Skipped` secondary action

### Behavior Details

- Pull-to-refresh re-syncs the plan from the backend.
- If the nutritionist edits a meal while the user is on this screen, show a `"Plan updated — tap to refresh"` toast. Do not auto-reload mid-read.
- Long-press a collapsed meal card → quick-log shortcut bottom sheet.

---

## 6. Meal Tracking Screen (Secondary)

> **How to reach:** Tap `Track Meals →` on the dashboard's Adherence Score card.

The adherence ledger — what the user actually did versus the plan.

### Tab Structure Inside This Screen

```
[ Today ]  |  [ History ]
```

### Meal Log States

| State | Visual Treatment | Meaning |
|---|---|---|
| Pending | Outlined card | Time window hasn't arrived |
| In window | Highlighted border | Eat-now prompt |
| Logged (full) | Solid green fill | Ate as planned |
| Logged (partial) | Amber fill | Ate a portion or substituted |
| Skipped | Muted + strikethrough | User skipped intentionally |
| Missed | Red outline, faded text | Time window passed with no action |

### Summary Indicators (top of screen)

- **Adherence percentage** — large, centered, prominent.
- **Today's streak count** — e.g., "6-day streak".
- **Progress pill** — `3 / 5 meals logged`.

### Logging Interaction Flow

```
User taps a meal row
          │
          ▼
Bottom sheet appears with 3 choices:
  [ Logged as planned ]
  [ Logged with substitution ]
  [ Skipped ]
          │
          ▼
Optional: add a note or photo
          │
          ▼
Tap Submit
          │
    ┌─────┴──────┐
    ▼            ▼
Optimistic   Backend sync
UI update    in background
    │
    ▼
Adherence score recalculates
Streak updates
Milestone reached? → Confetti animation
```

### History View

- Calendar grid showing days color-coded by adherence level.
- Tap a past day → read-only log for that date.
- No editing past logs.

---

## 7. Progress Screen (Secondary)

> **How to reach:** Tap `View Progress →` on the dashboard's Progress Preview card.

Visualizes the user's outcomes against the nutritionist's targets over time.

### Sections

#### Weight Tracking

- Smoothed line chart.
- Target weight as a dashed horizontal line.
- Latest entry highlighted.
- `+ Log Weight` CTA button at the top right.
- Tap a data point → date + value in a tooltip.

#### Body Metrics

- Toggleable metrics: waist, hips, body fat %, muscle mass.
- Whichever metrics the nutritionist has enabled for this user appear here.
- `+ Log Measurement` action.

#### Adherence Trend

- 7-day bar chart — one bar per day, filled to the day's adherence percentage.
- 7-day rolling average displayed as a number above the chart.

#### Weekly Summary

- Auto-generated text: *"This week you averaged 84% adherence, up 9% from last week. Weight trend: −0.4 kg."*

#### Goal Target

- Goal weight, target date, projected ETA based on current rate of change.
- Visual: progress bar from starting weight to goal weight with current position marker.

### Time Range Toggle

```
[ Week ]  [ Month ]  [ 3 Months ]  [ All ]
```

Toggle is sticky per section — changing the range for weight does not change the range for adherence.

---

## 8. Coach Notes Screen (Secondary)

> **How to reach:** Tap `Read More →` on the dashboard's Coach Note card.

The complete feed of guidance from the nutritionist.

### Note Types

| Type | Description | Display |
|---|---|---|
| **Pinned** | High-priority nutritionist message | Always at top, distinct card |
| **Daily** | Day-specific guidance | Listed by date, auto-archives after 48h |
| **Plan change** | Explains why a meal was updated | Inline with the affected meal + in this feed |
| **Motivational** | Short encouragement | Lighter visual weight |

### Screen Layout

- **Pinned note** — prominent card at the very top if one exists.
- **Filter bar** — `All · Daily · Plan Changes · Pinned`
- **Chronological feed** — newest first, date-grouped.
- Each note: coach avatar, name, timestamp, full message body, read/unread indicator.

### Read State

- Notes arrive as unread (badge on dashboard card + Nutrition tab icon).
- Opening this screen marks all visible notes as read.
- Tapping a specific note also marks it read individually.

---

## 9. Realtime Update Flow

```
┌───────────────────────────────────┐
│     Nutritionist Dashboard        │
│  (edits plan, notes, targets)     │
└──────────────┬────────────────────┘
               │  writes via API
               ▼
┌───────────────────────────────────┐
│         Backend APIs              │
│   (single source of truth)        │
└──────────────┬────────────────────┘
               │  exposes endpoints
               ▼
┌───────────────────────────────────┐
│      Fitflix User App             │
│   Nutrition Dashboard             │
│   (fetch → cache → render)        │
└───────────────────────────────────┘
```

### When the App Refreshes Data

| Trigger | What refetches |
|---|---|
| User taps Nutrition tab | Full dashboard — plan, summary, notes, adherence |
| App comes to foreground | Dashboard summary, today's plan |
| Pull-to-refresh | Whichever screen is currently active |
| Push notification received | Invalidate cache for the specific resource (note, plan, target) |
| 90-second poll (dashboard only) | Dashboard summary while Nutrition tab is active |
| After any user log | Adherence score, calorie ring, macros bars |

### Stale-While-Revalidate

Show the cached version immediately when the user opens a screen, then silently refresh in the background. Update the UI smoothly when new data arrives — no full-screen reloads.

### Update Notification Pattern

When the nutritionist publishes a change while the user is actively using the app:

- **New note:** Push notification + badge on Nutrition tab + badge on Coach Note card.
- **Meal plan change:** Silent background refetch + `"Plan updated"` toast (non-blocking).
- **Target change:** Silent background refetch + smooth re-animation of the calorie ring.

---

## 10. API Integration Expectations

> This section describes **frontend behavior** only. No backend code is generated here.

### Fetch Patterns by Screen

| Screen | Fetch on open | Refetch triggers |
|---|---|---|
| Dashboard | Yes | Tab tap, foreground, 90s poll, post-log |
| Meal Plan | Yes (by date) | Date change, pull-to-refresh |
| Tracking | Yes (today) | After each meal log, pull-to-refresh |
| Progress | Yes, lazy by time range | Range toggle, post-weight-log |
| Coach Notes | Yes | Pull-to-refresh, push notification |

### Caching Strategy

- Cache by **resource + date key**, e.g., `mealPlan:2026-05-22`.
- Recommended TTL values:

| Resource | TTL |
|---|---|
| Dashboard summary | 60 seconds |
| Today's meal plan | 5 minutes |
| Adherence / tracking | 30 seconds (or post-mutation) |
| Progress (weight, metrics) | 10 minutes |
| Coach notes | 3 minutes |
| Consultations | 5 minutes |

- On logout: purge all nutrition cache.

### Loading States

- Use **skeleton loaders** that match the exact layout of the content they replace. Never use a full-screen spinner.
- The dashboard must never appear blank. If cache is warm, show cached content immediately.
- Skeleton cards for: calorie ring, macros row, next meal card, meal list, coach note card.

### Empty States

Show user-friendly empty states with an illustration and a one-line message:

| Scenario | Message |
|---|---|
| No meal plan published yet | *"Your nutritionist is preparing today's plan. Check back soon."* |
| No coach notes yet | *"Your coach hasn't posted any notes yet."* |
| No weight logs yet | *"Log your first weight to see your trend."* |
| No tracking history | *"Start logging meals to build your history."* |

Empty states must never show raw `null` or a blank card.

### Error States

- Display an **inline error card** with a `Retry` button. Never redirect to a full-screen error page.
- Network errors: show offline indicator + retry.
- Server errors (5xx): *"Something went wrong. Tap to retry."*
- Auth errors: silently attempt token refresh; route to login only if refresh fails.

### Optimistic UI

Apply optimistic updates for these user actions (revert silently on backend failure):

- Logging a meal (full, partial, skipped)
- Adding a water glass
- Logging weight
- Marking a coach note as read

Always show a quiet error toast on rollback: *"Couldn't save your log. Try again."*

---

## 11. Recommended State Management

A **centralized nutrition store** is required. All screens read from this store, not from local state.

### Store Structure

```
nutritionStore
├── dashboard
│   ├── calorieSummary         { consumed, target, remaining }
│   ├── macros                 { protein, carbs, fat } × { consumed, target }
│   ├── hydration              { glasses, target }
│   ├── adherenceToday         { percentage, streak }
│   ├── nextMeal               Meal | null
│   └── upcomingConsultation   ConsultationPreview | null
│
├── mealPlan                   Map<dateString, Meal[]>
│
├── tracking
│   ├── logsToday              MealLog[]
│   └── history                Map<dateString, MealLog[]>
│
├── progress
│   ├── weightLog              WeightEntry[]
│   ├── bodyMetrics            MetricEntry[]
│   └── adherenceTrend         DailyAdherence[]
│
└── coachNotes                 CoachNote[]
```

### Flutter (Recommended: Riverpod)

- Each store slice → a `AsyncNotifierProvider` or `FutureProvider.family` (keyed by date for plan/tracking).
- Local persistence: **Isar** or **Hive** for offline reads.
- Push notifications → call `ref.invalidate(provider)` to force refetch.
- Optimistic updates: mutate local state first via `notifier.update(...)`, then call the API, revert on error.

### React Native (Recommended: TanStack Query + Zustand)

- **TanStack Query** handles server cache, background refetch, stale-while-revalidate, and retry.
- **Zustand** handles local UI state (selected date, expanded card IDs, scroll position).
- `queryClient.invalidateQueries(["nutritionDashboard"])` on push notification receipt.
- `AsyncStorage` adapter for offline persistence.

### Key Principles

- Never fetch from inside a widget or component. All fetch logic lives in providers/hooks.
- Derived values (e.g., adherence percentage = meals logged / meals planned) are computed as **selectors** from stored data, not recalculated on every render.
- The dashboard store slice refreshes on tab focus. Individual screen stores refresh on screen mount.

---

## 12. UX Recommendations

### Core Design Principles

- **Guidance-first, not data-first.** Surface what the user should *do*, not walls of numbers.
- **Coach presence.** Every piece of content on this module should feel like it comes from a real person — use the nutritionist's name and avatar wherever guidance appears.
- **Calm aesthetics.** Soft greens, warm neutrals, gentle gradients. No clinical whites with red alerts.
- **One action per moment.** The dashboard should always surface one clear primary action: *"Log your breakfast."*
- **Lightweight interaction.** A user should be able to log a meal in 2 taps. Never more.

### Motivation Systems

- Daily adherence ring — fills through the day as meals are logged.
- Streak counter — celebrates consecutive adherent days.
- Weekly recap in the coach notes feed — summarizes the past week in human language.
- Milestone celebrations at 7, 30, and 90 days of streaks — subtle animation, no interruptions.

### Reminders and Nudges

- Push notification at the start of each meal window: *"Time for lunch — Grilled chicken bowl is ready."*
- Hydration nudge in the afternoon if fewer than half the daily glasses are logged.
- Pre-consultation reminder 60 minutes and 10 minutes before a session.
- All reminders are dismissible and must respect system notification permissions.

### Avoid

- Presenting macros as a spreadsheet. Use visual bars, not tables.
- Hospital-style color coding (red for "bad", green for "good" on every metric).
- Guilt-inducing language for skipped or missed meals. Use neutral, forward-looking copy: *"Tomorrow is a fresh start."*
- Full-screen modals for simple logging actions. Use bottom sheets.
- Making consultation the dominant experience — users are here for daily guidance, not scheduling.

---

## 13. Future Enhancements

| Feature | Description |
|---|---|
| **AI meal scan** | User photographs a plate → estimated macros autofill the log |
| **Barcode scan** | Packaged food lookup → macros auto-populated from food database |
| **Wearable sync** | Apple Health / Google Fit integration for weight, steps, and hydration |
| **Smart nudges** | Context-aware suggestions: *"You're low on protein today — try the suggested snack."* |
| **Adaptive plans** | Backend adjusts targets week-over-week based on real adherence and outcomes |
| **Voice logging** | *"I had oats and two eggs"* → parsed and logged via speech-to-text |
| **Recipe view** | Tap a meal → step-by-step recipe with ingredient photos |
| **Weekly grocery list** | Auto-generated from the week's plan |
| **Offline-first mode** | Full log and view capability without network; syncs on reconnect |

---

## 14. Final Recommended Folder Structure

All nutrition screens and logic live inside a `nutrition` feature module. This keeps the new module fully isolated from existing app code.

### Flutter

```
lib/
├── features/
│   └── nutrition/
│       ├── screens/
│       │   ├── nutrition_dashboard_screen.dart   ← PRIMARY
│       │   ├── meal_plan_screen.dart             ← Secondary
│       │   ├── meal_tracking_screen.dart         ← Secondary
│       │   ├── progress_screen.dart              ← Secondary
│       │   └── coach_notes_screen.dart           ← Secondary
│       │
│       ├── widgets/
│       │   ├── dashboard/
│       │   │   ├── calorie_ring_card.dart
│       │   │   ├── macros_row_card.dart
│       │   │   ├── hydration_tracker_card.dart
│       │   │   ├── next_meal_card.dart
│       │   │   ├── meals_overview_card.dart
│       │   │   ├── adherence_score_card.dart
│       │   │   ├── progress_preview_card.dart
│       │   │   ├── coach_note_preview_card.dart
│       │   │   └── consultation_info_card.dart
│       │   ├── meal_plan/
│       │   │   ├── meal_card.dart
│       │   │   └── meal_substitutions_sheet.dart
│       │   ├── tracking/
│       │   │   ├── meal_log_row.dart
│       │   │   ├── quick_log_sheet.dart
│       │   │   └── adherence_summary_bar.dart
│       │   ├── progress/
│       │   │   ├── weight_chart.dart
│       │   │   ├── adherence_bar_chart.dart
│       │   │   └── body_metrics_card.dart
│       │   └── coach_notes/
│       │       └── coach_note_card.dart
│       │
│       ├── providers/
│       │   ├── nutrition_dashboard_provider.dart
│       │   ├── meal_plan_provider.dart
│       │   ├── tracking_provider.dart
│       │   ├── progress_provider.dart
│       │   └── coach_notes_provider.dart
│       │
│       ├── services/
│       │   ├── nutrition_api_service.dart
│       │   ├── nutrition_cache_service.dart
│       │   └── nutrition_sync_service.dart
│       │
│       ├── models/
│       │   ├── meal_plan.dart
│       │   ├── meal.dart
│       │   ├── meal_log.dart
│       │   ├── macros.dart
│       │   ├── hydration_entry.dart
│       │   ├── coach_note.dart
│       │   ├── weight_entry.dart
│       │   └── consultation_preview.dart
│       │
│       └── utils/
│           ├── adherence_calculator.dart
│           └── streak_calculator.dart
│
└── shared/
    ├── theme/
    ├── navigation/
    │   └── bottom_nav_bar.dart    ← Add Nutrition tab here
    └── network/
```

### React Native

```
src/
├── features/
│   └── nutrition/
│       ├── screens/
│       │   ├── NutritionDashboardScreen.tsx    ← PRIMARY
│       │   ├── MealPlanScreen.tsx              ← Secondary
│       │   ├── MealTrackingScreen.tsx          ← Secondary
│       │   ├── ProgressScreen.tsx              ← Secondary
│       │   └── CoachNotesScreen.tsx            ← Secondary
│       │
│       ├── components/
│       │   ├── dashboard/
│       │   │   ├── CalorieRingCard.tsx
│       │   │   ├── MacrosRowCard.tsx
│       │   │   ├── HydrationTrackerCard.tsx
│       │   │   ├── NextMealCard.tsx
│       │   │   ├── MealsOverviewCard.tsx
│       │   │   ├── AdherenceScoreCard.tsx
│       │   │   ├── ProgressPreviewCard.tsx
│       │   │   ├── CoachNotePreviewCard.tsx
│       │   │   └── ConsultationInfoCard.tsx
│       │   ├── meal-plan/
│       │   │   ├── MealCard.tsx
│       │   │   └── MealSubstitutionsSheet.tsx
│       │   ├── tracking/
│       │   │   ├── MealLogRow.tsx
│       │   │   ├── QuickLogSheet.tsx
│       │   │   └── AdherenceSummaryBar.tsx
│       │   ├── progress/
│       │   │   ├── WeightChart.tsx
│       │   │   ├── AdherenceBarChart.tsx
│       │   │   └── BodyMetricsCard.tsx
│       │   └── coach-notes/
│       │       └── CoachNoteCard.tsx
│       │
│       ├── hooks/
│       │   ├── useNutritionDashboard.ts
│       │   ├── useMealPlan.ts
│       │   ├── useTracking.ts
│       │   ├── useProgress.ts
│       │   └── useCoachNotes.ts
│       │
│       ├── services/
│       │   ├── nutritionApi.ts
│       │   ├── nutritionCache.ts
│       │   └── nutritionSync.ts
│       │
│       ├── store/
│       │   ├── nutritionStore.ts
│       │   └── selectors.ts
│       │
│       ├── models/
│       │   ├── MealPlan.ts
│       │   ├── Meal.ts
│       │   ├── MealLog.ts
│       │   ├── Macros.ts
│       │   ├── CoachNote.ts
│       │   ├── WeightEntry.ts
│       │   └── ConsultationPreview.ts
│       │
│       └── utils/
│           ├── adherence.ts
│           └── streaks.ts
│
└── shared/
    ├── theme/
    ├── navigation/
    │   └── BottomTabNavigator.tsx    ← Add Nutrition tab here
    └── network/
```

---

## Appendix — Implementation Checklist

### Navigation
- [ ] Nutrition tab added to existing bottom nav between Exercise and DNA
- [ ] Nutrition tab disabled / locked state for non-onboarded users
- [ ] Nutrition tab always opens Nutrition Dashboard (no sub-navigation bar)

### Dashboard (Primary Screen)
- [ ] Greeting header with nutritionist name and avatar
- [ ] Calorie summary ring — animated, fills from logs, shows target from nutritionist
- [ ] Macros row — protein / carbs / fat progress bars
- [ ] Hydration tracker — tap-to-log glasses, inline (no separate screen)
- [ ] Next meal card — eating window, CTA, advances on log
- [ ] Today's meals overview — compact status list with `View Meal Plan →` link
- [ ] Adherence score card — percentage, streak, `Track Meals →` link
- [ ] Progress preview card — mini chart, `View Progress →` link
- [ ] Coach note preview card — pinned note, unread badge, `Read More →` link
- [ ] Consultation info card — small, low-emphasis, no dedicated screen

### Secondary Screens
- [ ] Meal Plan — date selector, expandable meal cards, substitutions, nutritionist notes
- [ ] Tracking — all five meal states, adherence %, streak, history calendar
- [ ] Progress — weight chart, adherence bar chart, body metrics, time range toggle
- [ ] Coach Notes — pinned note, filtered feed, read/unread state

### Data & State
- [ ] Centralized nutrition store with all slices
- [ ] Stale-while-revalidate caching for all resources
- [ ] Optimistic updates for all user logs
- [ ] Push notification → cache invalidation wired up
- [ ] 90-second poll active while Nutrition Dashboard tab is in foreground

### UX Quality
- [ ] Skeleton loaders on all cards (no full-screen spinners)
- [ ] Friendly empty states on all sections
- [ ] Inline error cards with retry (no full-screen errors)
- [ ] Consultation card is low-emphasis — not dominating the dashboard
- [ ] Wellness aesthetic verified — no clinical or spreadsheet feel

---

**End of document.**
