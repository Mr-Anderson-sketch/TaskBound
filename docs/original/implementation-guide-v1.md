# **⚙️ TimeBound – Developer Implementation Guide**

**Version:** 1.0  
 **Platform:** Windows (Electron App)  
 **Goal:** Sticky, always-on-top desktop app for focused timeboxing and task scoring.

---

## **🧩 Core Concept**

* Each **task** has a countdown timer.

* **\+1** score for early completion.

* **−1** for adding time.

* App shows **total completed** (all-time) and **today completed** counts.

* Everything is stored **locally** in `%APPDATA%\TimeBound\state.json`.

* Window is **always on top** and **cannot exceed 1/16** of screen area.

---

## **🏗️ Stack & Setup**

**Recommended Tech Stack**

`Electron + React + TypeScript + TailwindCSS`

**Recommended Libraries**

`electron`  
`react, react-dom`  
`tailwindcss`  
`uuid`  
`fs-extra (for atomic writes)`

**Project Structure**

`/timebound`  
  `/src`  
    `/main        // Electron main process`  
      `main.ts`  
    `/renderer    // React UI`  
      `App.tsx`  
      `components/`  
        `TaskRow.tsx`  
        `EditModal.tsx`  
        `Popup.tsx`  
      `store/`  
        `state.ts`  
  `package.json`  
  `electron-builder.json`

**Packaging Tool:**  
 `electron-builder` → `.exe`

---

## **🧠 Core Features Breakdown**

### **1\. UI & Behavior**

| Feature | Implementation Notes |
| ----- | ----- |
| Always on top | `BrowserWindow({ alwaysOnTop: true })` |
| Size limit | Max width/height \= 1/4 screen width × 1/4 height |
| Timer tick | Update every second via React state or IPC |
| Top bar | Display: Score, Total Completed, Today Completed |
| Task list | Show current \+ 2–3 upcoming |
| Buttons | Add Task, Complete, Add Time (+) |
| Popup | Modal appearing every 3 minutes if current task has no time |

---

### **2\. Task Data Model**

`interface Task {`  
  `id: string;`  
  `title: string;`  
  `createdAt: string;`  
  `updatedAt: string;`  
  `completedAt?: string;`  
  `timeAssignedSeconds?: number;`  
  `remainingSeconds?: number;`  
  `status: 'pending' | 'in_progress' | 'completed' | 'struck';`  
  `history: {`  
    `type: 'manual_complete' | 'auto_complete' | 'add_time';`  
    `amountSeconds?: number;`  
    `at: string;`  
  `}[];`  
`}`

---

### **3\. App State Schema**

`interface AppState {`  
  `score: number;`  
  `tasks: Task[];`  
  `stats: {`  
    `totalCompleted: number;`  
    `todayCompleted: number;`  
    `lastCompletionDate: string;`  
  `};`  
  `meta: {`  
    `lastSavedAt: string;`  
    `appVersion: string;`  
  `};`  
`}`

---

### **4\. Persistence**

| Rule | Implementation |
| ----- | ----- |
| Path | `%APPDATA%\TimeBound\state.json` |
| Backup | `.bak` copy |
| Atomic Save | Write to temp → rename → backup |
| On Crash | Load `.bak` if main fails |
| On Startup | Deduct elapsed time from current task |

---

### **5\. Timer Logic**

* One task active at a time (topmost).

* Timer runs once per second.

* On hitting 0 → mark task `struck` and move to next.

* On manual completion → mark `completed`, \+1 score.

* On time add → increase time, −1 score.

* On restart → deduct elapsed real time using `lastSavedAt`.

---

### **6\. Popup Logic**

**Trigger:** Active task has no `timeAssignedSeconds`.  
 **Action:**

* Show modal every 3 minutes with:

  * “Set Time” → opens edit modal

  * “Remind Later” → snoozes

  * “Close App” → exits

* Stop reminders once time is set.

---

### **7\. Completion Counters**

| Counter | Rule |
| ----- | ----- |
| Total Completed | \+1 on every task completion |
| Today Completed | \+1 if same date as lastCompletionDate |
| Reset Today | If system date ≠ lastCompletionDate, reset to 0 on next completion |
| Display | “Completed: 42 total |

---

### **8\. Editing Rules**

* Double-click task number → open modal

* Editable fields: text, time

* If increased → −1 score (confirm first)

* If decreased → no penalty

* Save immediately after closing modal.

---

### **9\. UI Example Layout**

`+-------------------------------------------+`  
`| TimeBound           Score: +3             |`  
`| Completed: 42 total | 3 today             |`  
`|-------------------------------------------|`  
`| 1. [00:12:45]  Write daily summary        |`  
`| 2. [---]        Plan feature sprint       |`  
`| 3. [25:00]      Deep work: UI design      |`  
`| [+ Add Task] [Complete] [Add Time +]      |`  
`+-------------------------------------------+`

---

### **10\. Core Event Flow**

| Event | Effect |
| ----- | ----- |
| Add task | If first → require time |
| Start timer | Begins countdown |
| Add time | −1 score |
| Complete early | \+1 score |
| Timer \= 0 | Auto complete, no score |
| Edit task | Save immediately |
| App quit/reopen | Resume timer |
| Date changes | Reset “todayCompleted” |
| Corrupt file | Recover from `.bak` |

---

### **11\. Milestone Plan**

| Milestone | Deliverable |
| ----- | ----- |
| M1 | Basic Electron window \+ TopMost |
| M2 | Task CRUD \+ JSON persistence |
| M3 | Timer \+ scoring logic |
| M4 | Popup \+ edit modal |
| M5 | Completion counters |
| M6 | Backup/recovery \+ persistence polish |
| M7 | Packaging & final QA |

---

### **12\. Testing Checklist**

| ✅ Test Case | Expected Behavior |
| ----- | ----- |
| Create task w/o time | Blocked with alert |
| Add time | −1 score |
| Complete early | \+1 score |
| Timer hits 0 | Auto complete |
| App restart | Timer resumes |
| Missing time | Popup every 3 min |
| Date change | Today counter resets |
| Corrupt JSON | Loads `.bak` file |

---

### **13\. Visual/UX Notes**

* Minimal, focus-friendly UI.

* Flat design with clear contrast.

* Typographic emphasis on task \+ time.

* Optional color hints for task states:

  * Active: Blue

  * Completed: Green

  * Struck: Gray

---

### **14\. Out-of-Scope (v1)**

* Undo/redo

* Dark mode

* Analytics

* Cloud sync

* Export/import

