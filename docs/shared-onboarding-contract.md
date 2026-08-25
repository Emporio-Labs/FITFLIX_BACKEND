# Shared onboarding contract

Fitflix onboarding is one member-level record read by both the member app and the front-desk web dashboard. It is not one sequential wizard.

| Step | Shared key | Primary owner | Completion evidence |
|---|---|---|---|
| Active X test | `ACTIVE_X_TEST` | Centre | Front desk or centre staff marks the physical test complete. |
| DNA sample | `DNA_SAMPLE` | Centre | Front desk or centre staff marks the sample collected and registered. |
| VALD test | `VALD_TEST` | Centre | Front desk or centre staff marks the VALD assessment complete. |
| Nutrition appointment | `NUTRITION_APPOINTMENT` | Member app | The member books through the existing nutrition booking flow; web reads the booking status. |
| Sport scientist appointment | `SPORT_SCIENTIST_APPOINTMENT` | Shared booking record | The member app may create the appointment; web reads it and can show the status at check-in. |
| Plan & PT trainer assignment | `PLAN_TRAINER_ASSIGNMENT` | Centre | Active membership and an assigned trainer are both present. |

The app continues to collect profile and health information through its existing profile, health marker, goals, consent, and report screens. Those records are app-owned prerequisites, not additional centre checklist cards. The existing nutrition booking remains the app-owned appointment path. The backend must allow the six shared cards to complete in any order and must derive overall completion from all six shared keys plus the app-owned prerequisites.

The front desk check-in surface should never block a member solely because a physical onboarding action is incomplete. It should clearly flag the missing steps, link staff to the member record, and allow the visit to proceed.
