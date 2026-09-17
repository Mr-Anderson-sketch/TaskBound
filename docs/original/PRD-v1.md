# **🧭 Product Requirements Document (PRD)**

## **Application Name: TimeBound**

**Platform:** Windows 10+ (Local Desktop App)  
 **Version:** 1.0  
 **Type:** Sticky, always-on-top productivity tool  
 **Primary Goal:** Lightweight, visually engaging timeboxing tool to help users stay focused by associating time limits with tasks and gamifying completion.

---

## **1\. Overview**

**Concept:**  
 TimeBound is a small Windows desktop app (similar to a sticky note) that helps users execute tasks within strict time limits.  
 Each task has a **countdown timer**, and the app keeps score based on how effectively the user finishes tasks:

·        **\+1** point if the user finishes early.

·        **−1** point every time the user adds more time.

The app maintains **two completion counters**:

1\.     **Total tasks completed (lifetime)**

2\.     **Tasks completed today**

The window always stays on top, occupies a small fixed space (≤ 1/16 of the screen area), and cannot be expanded beyond that.  
 The experience is local, private, and efficient — no cloud or external dependencies.

---

## **2\. Key Functional Goals**

| Feature | Description |
| ----- | ----- |
| Always-on-top Sticky UI | Mini window, resizable only downwards (not larger than 1/16 of screen). |
| Countdown Timer | Each task has an associated timer; only topmost (current) task’s timer runs. |
| Score Tracking | \+1 for early completion; −1 for adding more time. |
| Popups for Missing Time | If a current task has no time, the app prompts every 3 minutes until time is set or app closed. |
| Editing | Double-click on task number to edit both text and time. |
| Data Persistence | All state saved locally in `%APPDATA%\TimeBound\state.json` (atomic write \+ backup). |
| Completion Counters | Track total tasks completed and today’s completions. |
| Clean UI | Vibrant colors, clean typography, easy to read. |
| Local-first | No network or cloud access. |

---

## **3\. User Flow Summary**

1\.     **Start the app:** A small sticky window appears (always-on-top).

2\.     **Add first task:** Must include a time value to start.

3\.     **Timer starts:** Top task counts down visibly.

4\.     **Task finishes early:** User clicks “Complete” → \+1 score.

5\.     **Task runs out of time:** Auto strikes out → moves to next task.

6\.     **Next task has no time:** Popups appear every 3 minutes prompting user to assign time.

7\.     **User adds time:** Time increases, −1 score.

8\.     **Progress visible:** Score, total completed, and today’s completed displayed at top.

9\.     **All data stored locally and persists between sessions.**

---

## **4\. Core Functional Requirements**

### **4.1 Task Management**

Each task has:

·        `title` (string)

·        `timeAssignedSeconds` (int, optional)

·        `remainingSeconds` (int, optional)

·        `status`: `'pending' | 'in_progress' | 'completed' | 'struck'`

·        `createdAt`, `updatedAt`, and `completedAt`

·        `history`: records time additions, completions, etc.

**Rules:**

·        The **first task** cannot be created without a time value.

·        Only one task (the topmost) can have an active countdown.

·        When the active task completes, the next one becomes active.

·        If the next task lacks a time, popup reminders appear every 3 minutes.

---

### **4.2 Timer Logic**

·        Countdown updates every second.

·        When timer hits 00:00 → task is struck and marked complete.

·        If user adds time manually → timer increases and score −1.

·        If user manually completes early → \+1 score.

·        Timer resumes correctly after app restart (using saved timestamp).

---

### **4.3 Popups (Missing Time Reminder)**

**Trigger:** When the top task has no time value.  
 **Behavior:**

·        Popup appears every 3 minutes (configurable).

·        Text:  
 “Time not set for current task: ‘Task Name’. Please assign time.”

·        Buttons: **Set Time**, **Remind Later**, **Close App**

·        The popup stops appearing only when a time is set or app is closed.

---

### **4.4 Scoring System**

| Event | Score Change |
| ----- | ----- |
| Add time | −1 |
| Finish early (before timer ends) | \+1 |
| Auto completion (timer hits 0\) | No change |

Displayed prominently at the top bar.

---

### **4.5 Completion Counters**

#### **a. Total Tasks Completed**

·        Incremented for every completion event (manual or automatic).

·        Never decreases unless reset manually.

·        Persisted across sessions.

#### **b. Tasks Completed Today**

·        Increments each time a task completes on the same calendar date.

·        If the date changes, resets to 1 on the next completion.

·        Automatically resets when the system date changes or the app restarts the next day.

#### **c. UI Display**

Example:

Score: \+3   |   Completed: 42 total | 3 today  
---

### **4.6 Editing**

·        Double-click the task number to open an **edit modal**:

o   Editable fields: task text, time.

o   Increasing time → −1 score (with confirmation).

o   Decreasing time → no score penalty.

·        Save updates immediately.

---

### **4.7 Data Persistence**

**Storage Location:**  
 `%APPDATA%\TimeBound\state.json`

**Backup:**  
 `%APPDATA%\TimeBound\state.json.bak`

**Atomic Write Procedure:**

1\.     Save new state to `state.tmp.json`

2\.     Rename to `state.json`

3\.     Copy old version as `.bak`

**Example Schema:**

{  
  "score": 3,  
  "tasks": \[  
	{  
  	"id": "uuid",  
  	"title": "Work on landing page",  
  	"createdAt": "2025-11-01T08:32:41Z",  
  	"updatedAt": "2025-11-01T09:01:12Z",  
  	"timeAssignedSeconds": 1500,  
  	"remainingSeconds": 0,  
  	"status": "completed",  
  	"completedAt": "2025-11-01T09:01:12Z",  
  	"history": \[  
    	{  
      	"type": "manual\_complete",  
      	"amountSeconds": 934,  
      	"at": "2025-11-01T09:01:12Z"  
    	}  
  	\]  
	}  
  \],  
  "stats": {  
	"totalCompleted": 42,  
	"todayCompleted": 3,  
	"lastCompletionDate": "2025-11-01"  
  },  
  "meta": {  
	"lastSavedAt": "2025-11-01T09:01:12Z",  
	"appVersion": "1.0.0"  
  }  
}

**Persistence Rules:**

·        Save after every significant change (task add/edit/complete/time update).

·        Use atomic write method.

·        On startup, if `state.json` corrupted → load `.bak` fallback.

·        Store `lastSavedAt` for timer recovery across restarts.

·        On resume, subtract elapsed time from the current task’s remainingSeconds.

---

### **4.8 UI & Design Rules**

·        **Top Bar:** App name, score, total and today’s completions.

·        **Task List:** Show top task prominently; show 2–3 tasks below.

·        **Layout Example:**

·    	\+-------------------------------------------+  
·    	| TimeBound    	Score: \+3            	|  
·    	| Completed: 42 total | 3 today         	|  
·    	|-------------------------------------------|  
·    	| 1\. \[00:12:45\]  Work on landing page...	|  
·    	| 2\. \[---\]    	Prepare tax doc...    	|  
·    	| 3\. \[25:00\]  	Deep work: feature X  	|  
·    	| \[+ Add Task\] \[Complete\] \[Add Time \+\]  	|  
·    	\+-------------------------------------------+

·        **Window Behavior:**

o   Max size ≤ 1/16 of screen area.

o   Resizable smaller, not larger.

o   Always on top (`TopMost`).

o   Clean modern colors, legible fonts, bright contrast.

---

## **5\. Non-Functional Requirements**

| Category | Requirement |
| ----- | ----- |
| Performance | Timer updates once per second, low CPU usage. |
| Reliability | Atomic writes, fallback backups. |
| Privacy | 100% local data; no cloud sync. |
| Accessibility | Keyboard navigation, readable text (min 14pt). |
| Resilience | Auto recovery from crash/corrupt file. |
| Persistence | Full state retention between sessions. |

---

## **6\. Acceptance Criteria**

| \# | Scenario | Expected Behavior |
| ----- | ----- | ----- |
| 1 | Create first task without time | App blocks creation, shows “Time required for first task.” |
| 2 | Task timer runs | Timer decrements 1s/sec. |
| 3 | Timer hits 0 | Task struck out, moves to next task. |
| 4 | Add time | Timer increases, score −1. |
| 5 | Finish early | Score \+1. |
| 6 | Current task missing time | Popup every 3 minutes until time set or app closed. |
| 7 | Edit time upward | −1 score; downward → no change. |
| 8 | App restarts | Timer resumes with elapsed time deducted. |
| 9 | Task completion | Increments total and today counters. |
| 10 | Date changes overnight | Today counter resets on next completion. |
| 11 | Backup & recovery | App loads `.bak` if main file corrupt. |

---

## **7\. Implementation Recommendations**

**Tech Stack:**

·        **Electron \+ React \+ TypeScript \+ Tailwind CSS**

·        Local persistence via JSON (fs-extra or lowdb).

·        Packaging via `electron-builder` for `.exe`.

**Suggested Folder Structure:**

/timebound  
 /src  
	/main    	// Electron main process  
  	main.ts  
	/renderer	// React UI  
  	App.tsx  
  	components/  
    	TaskRow.tsx  
    	EditModal.tsx  
    	Popup.tsx  
  	store/  
    	state.ts  // read/write state.json  
  package.json  
  electron-builder.json

**Recommended Libraries:**

·        `electron`

·        `react`, `react-dom`

·        `tailwindcss`

·        `uuid`

·        `fs-extra` or `lowdb`

·        `electron-builder`

---

## **8\. Task State Transitions**

| From | To | Trigger |
| ----- | ----- | ----- |
| pending | in\_progress | Becomes top task and has time assigned |
| in\_progress | completed | User completes early |
| in\_progress | struck | Timer hits zero |
| any | completed | Manual finish |
| completed/struck | — | Archival state |

---

## **9\. App Lifecycle**

1\.     **Launch** → Load `state.json` → Resume timer if active.

2\.     **Idle Tick (every 1s)** → Update timer, persist.

3\.     **Task Completion** → Update status, increment counters, persist.

4\.     **Shutdown** → Save state to disk atomically.

5\.     **Restart** → Recalculate remainingSeconds from lastSavedAt.

---

## **10\. Optional Future Enhancements (Out of Scope for v1)**

·        Undo last action.

·        Productivity analytics (average time per task).

·        Color themes and dark mode.

·        Export/import task history.

·        Optional cloud sync.

---

## **11\. Example Commit Milestones (for development plan)**

| Milestone | Description |
| ----- | ----- |
| M1 | Basic Electron window (TopMost, size limit) |
| M2 | Task CRUD with JSON persistence |
| M3 | Timer \+ scoring logic |
| M4 | Edit modal \+ add-time penalty |
| M5 | Popup reminders |
| M6 | Completion counters \+ UI |
| M7 | Packaging and QA testing |

 

