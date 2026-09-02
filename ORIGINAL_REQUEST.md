# Original User Request

> **Historical record — do not read as current specification.**
> This is the verbatim brief that started Phase 3, kept for provenance. The
> system has moved on from it in places: `/api/omrs` was never built, and R2's
> "TensorFlow.js or OpenCV.js" object detection was deliberately not
> implemented — `README.md` explains under "What it deliberately does not do"
> why free height cannot be recovered from an image without a scale. For what
> the system actually does today, read `README.md`; for how to run it, `docs/`.


## Initial Request — 2026-08-17T17:26:27+05:30

# Teamwork Project Prompt — Draft

> Status: Step 9 — Ready for launch — awaiting user approval
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Use a very large team of agents.

Upgrade the WRS Raipur Wagon Quality Control application with "Phase 3: The Holy Grail" — a suite of advanced AI and hardware-simulated features designed to completely eliminate manual data entry, automate defect detection, and preempt supply chain bottlenecks. 

Working directory: /Users/patty/Desktop/WRS_Raipur
Integrity mode: development

**IMPORTANT**: The app is currently a fully verified React/Express/SQLite application. You must build these new features *into* the existing architecture without breaking the 7-stage lifecycle or Phase 1 & 2 tests. Since this is for a laptop/tablet prototype, simulate industrial hardware (RFID, acoustic arrays, CV cameras) using standard web APIs (Webcam, Microphone, Web Speech API).

## Requirements

### R1. Hands-Free Voice UI (The "Greasy Gloves" Solution)
Implement a voice command interface for the Component Inspection stage. Inspectors should be able to click a "Start Voice Inspection" button and speak commands (e.g., "Outer spring passes", "Condemn friction wedge"). The app must use browser speech recognition (Web Speech API) to parse these commands and automatically update the checklist UI without requiring manual touch input.

### R2. Direct Computer Vision Measurement (AR Simulation)
Add a "Smart Vision" mode to the camera capture. Using TensorFlow.js or OpenCV.js in the browser, process the live webcam feed to identify objects (e.g., drawing a bounding box around a spring or component). Provide simulated on-screen AR measurements and automatically flag if the component is out of tolerance (e.g., a "Pass" or "Fail" overlay directly on the camera feed). 

### R3. Smart Acoustic Bearing & Leak Detection
Implement a "Sound Diagnostic" tool for the Final QC Gate / Reassembly stage. Use the Web Audio API to capture microphone input. Provide a visual equalizer/waveform. If the user makes a specific sound (e.g., a continuous hiss simulating an air leak, or a rhythmic tapping simulating a broken bearing), the audio analysis engine should detect the anomaly frequency and automatically flag a defect in the UI.

### R4. Component "Health Passports" (Serialization)
Shift the schema from just tracking wagons to tracking serialized components. High-value parts (Wheelsets, Bearings, Draft Gears) must have unique serial numbers. Add a QR scanner (using the webcam) that allows inspectors to scan a serialized part, view its entire historical lifecycle across different wagons, and reassign it to the current wagon.

### R5. Pre-Arrival AI Triage & Supply Chain
Create a simulated "Trackside OMRS Data Feed" that predicts what a wagon will need before it enters Stage 1 (Entry Registration). When registering a new wagon, the system should check this mock API, predict failing components (e.g., "Predicted: Condemned Snubber Spring"), and automatically reserve those parts in a newly created "Stores Depot Inventory" module. 

## Acceptance Criteria

### Verification Approach
Due to the hardware-simulation nature of this update, verification will rely on comprehensive E2E Playwright tests and visual inspection by an Agent-as-Judge to confirm the UI elements exist and respond to browser hardware APIs.

### Functional Criteria
- [ ] **Voice UI**: Voice inspection button exists. Speaking a recognized command updates the corresponding checklist item status visually.
- [ ] **Computer Vision**: Camera feed opens with an active CV model drawing bounding boxes over recognized objects and overlaying simulated measurements.
- [ ] **Acoustic Detection**: Audio diagnostic screen displays a live waveform from the mic and triggers a defect alert when audio thresholds (representing leaks/grinding) are breached.
- [ ] **Component Passports**: A distinct inventory/passport view exists. Scanning/entering a serial number reveals a component's history, and components can be uniquely assigned to wagons.
- [ ] **Pre-Arrival Triage**: New wagons automatically pull a "Predicted Defects" list upon registration, and those items are decremented from a simulated Stores Inventory.
- [ ] **Non-Regression**: The core 7-stage lifecycle, PDF certificate generation, and DRM dashboards from Phase 2 continue to function flawlessly.

## Follow-up — 2026-08-20T03:44:49Z

# Teamwork Project Prompt — Draft

> Status: Step 9 — Ready for launch — awaiting user approval
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Use a small focused team.

Complete UX/UI Simplification and Smart Vision enhancement for the WRS Raipur Wagon Quality Control application. The backend and AI features are complete, but the frontend needs to be stripped down for real-world shop floor usability.

Working directory: /Users/patty/Desktop/WRS_Raipur
Integrity mode: development

## Requirements

### R1. Role-Based UX Simplification (Inspector View)
Redesign the primary view for the `INSPECTOR` role to be incredibly simple and touch-friendly for shop floor workers. 
- They should not see complex data tables. 
- Upon logging in, they should see large, highly visible calls-to-action (e.g., "Scan New Wagon QR", "Start Voice Inspection").
- Ensure all complex routing (Dashboards, Analytics, Inventory) remains hidden from them and strictly reserved for Admins/Supervisors.

### R2. Smart Vision Context Filtering (Computer Vision)
Enhance the existing "Smart Vision Mode" (the AR camera feature) to include intelligent noise filtering. 
- The UI overlay should visually indicate that it is detecting and ignoring background noise (like humans, tools, or scaffolding).
- The system must ensure that only the targeted railway component (e.g., a spring or caliper) is highlighted and recorded in the audit trail, explicitly discarding the human/background data.

## Acceptance Criteria

### UI Simplification Verification
- [ ] Logging in as an `INSPECTOR` presents a drastically simplified, touch-friendly landing page with zero analytics charts or administrative clutter.
- [ ] Large "Scan Wagon" or "Start Inspection" buttons are the primary focus of the Inspector UI.

### Smart Vision Verification
- [ ] The AR Camera modal visually demonstrates (via UI feedback/console) that it recognizes "Human" or "Background Noise" and actively filters it out.
- [ ] Captured images/measurements strictly record the target component.
