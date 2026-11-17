# Privacy policy addition: Wearable & Health Platform Data

**Draft for legal review — not yet published.**

**Where it goes.** Add this to https://fitflix.in/pages/privacy.html as **section 2.5** (under "2. Information We Collect"). The policy's existing numbering is 1–9; the parts below that touch other sections say which section they belong in.

**Why it's needed.** Publishing it is a hard requirement before release:
- Apple's App Review rule 5.1.3 and Google's Health Connect policy both require the privacy policy to describe health-data use.
- The link in the app (Connected devices → "Read our privacy policy") points to this page.
- So do the Health Connect permission screens (`MainActivity.PRIVACY_POLICY_URL`).

Update **Last Updated** when you publish.

---

## 2.5 Wearable and Health Platform Data

If you choose to connect a wearable, FitFlix reads health and fitness data from your phone's health store: **Apple Health** on iPhone, or **Health Connect** on Android. Most watches, including Apple Watch, Fitbit, Samsung Galaxy Watch and Garmin, save their data there, and FitFlix reads it from that store. We do not connect to your watch maker's account and we never receive your login for any other service.

**What we read** (only after you grant access on your phone):

- Steps
- Active calories burned
- Walking and running distance
- Heart rate and resting heart rate
- Workouts (type, start and end time, duration)
- Body weight
- Sleep (bedtime, wake time and time asleep)

We read **only** these types. FitFlix **never writes** to Apple Health or Health Connect.

We do not read anything else in your health store, such as medical records, medications, reproductive health or location. We read only the last 30 days when you first connect, then new data each time you open the app. We do not read in the background.

### Why we use it

We use wearable data **only** to:

- show your activity, heart rate, workouts and sleep in the FitFlix app; and
- if you choose, let **your assigned coach** (your trainer or nutritionist) see it to tailor your training and nutrition plan.

**We never use wearable or health-platform data for advertising or marketing, never sell it, and never share it with data brokers or advertising networks.** We do not use it to decide your eligibility for any membership, price or offer. We do not use it for the personalised follow-up described elsewhere in this policy.

### Your consent and choices

Wearable data is collected only with your **specific consent**, separate from your other consents to FitFlix, as required by the Digital Personal Data Protection Act, 2023. There are two separate switches in **Profile → Connected devices**:

1. **Sync wearable data**: lets FitFlix read and store the data listed above.
2. **Share with my coach**: lets your assigned trainer or nutritionist see it. This is off unless you turn it on, and it only works while sync is on.

You can turn either switch off at any time, as easily as you turned it on. **Turning off sync permanently deletes all wearable data FitFlix has stored** and turns off coach sharing. **Disconnecting** Apple Health or Health Connect deletes the data synced from it; sleep you logged by hand in FitFlix is kept. You can also remove FitFlix's access at any time in Apple Health or Health Connect settings on your phone.

### Children

Wearable sync is **not available to anyone under 18**, with or without parental consent. If we do not know your age, sync stays off until you add your date of birth.

### Who can see it

- **You**, in the FitFlix app.
- **Your assigned trainer or nutritionist**, only if you turned on "Share with my coach". Other trainers, nutritionists and front-desk staff cannot see it.
- **FitFlix administrators**, only if you turned on sharing, and only to support your coaching.
- **Our hosting provider** (Amazon Web Services, Mumbai region), which stores the data on our behalf under contract and may not use it for any other purpose.

We do not share wearable data with any other third party, except where the law requires us to.

### Retention and deletion

We keep wearable data while sync is on and your account is active. It is deleted:

- immediately when you turn off sync,
- immediately for the source you disconnect, and
- when your account is deleted, together with your other health records (see section 8).

[LEGAL: confirm and state the backup retention period, e.g. "Copies in encrypted backups are overwritten within 30 days."]

### Security

Wearable data is encrypted in transit (HTTPS/TLS) and stored in our access-controlled database [LEGAL/ENG: confirm encryption at rest on the production MongoDB volume before publishing this sentence]. Staff access is limited to the roles described above.

---

## Changes to other sections

**3. How We Use Your Information.** Add:

> If you connect a wearable, we use that data only as described in section 2.5. It is never used for advertising, marketing or sale.

**4. Sensitive Personal Data.** Add:

> Data from Apple Health and Health Connect (activity, heart rate, workouts, weight and sleep) is health data. We treat it as sensitive, collect it only with your specific consent, and handle it as described in section 2.5.

**5.1 Authorized Staff.** The current text says health data may be accessed by FitFlix trainers, nutritionists and medical staff. Add the exception:

> except wearable data, which only your assigned coach can see, and only if you turn on "Share with my coach".

**9. Your Rights.** Make sure it lists, under the DPDP Act:
- the right to access, correct and erase your data;
- the right to withdraw consent at any time (for wearables, directly in the app);
- the right to nominate someone to act for you; and
- the right to raise a grievance.

Name the **Grievance Officer** with an email address and response time. If the grievance isn't resolved, members can complain to the **Data Protection Board of India**.

[LEGAL: fill in the Grievance Officer's name, email and response time.]

---

## Matching declarations (owner to file)

**Apple App Store Connect → App Privacy.** Add **Health & Fitness → Health** and **Fitness**, each marked:
- Linked to the user: yes
- Used for tracking: **no**
- Purpose: App Functionality

**Google Play Console:**
- **Data safety:** add **Health and fitness → Health info, Fitness info**.
  - Collected: yes. Shared: **no** (processing by our own staff and hosting provider is not "sharing" under Play's definition).
  - Optional: yes. Encrypted in transit: yes. Users can request deletion: yes.
- **Health Connect permissions declaration:** justify each of these permissions with the use described under "Why we use it" above:
  - READ_STEPS
  - READ_ACTIVE_CALORIES_BURNED
  - READ_DISTANCE
  - READ_HEART_RATE
  - READ_RESTING_HEART_RATE
  - READ_EXERCISE
  - READ_WEIGHT
  - READ_SLEEP
- **Health apps declaration:** select "Fitness and wellness / activity tracking".
