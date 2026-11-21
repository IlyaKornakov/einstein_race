# Relativistic Grand Prix — 3D Special Relativity Racing & World Simulation

**Live on GitHub Pages:** https://ilyakornakov.github.io/einstein_race/

An interactive, browser-based WebGL2 3D racing game and open free-roam urban simulation where the speed of light $c$ is lowered to everyday vehicle speeds (default $c = 25\text{ m/s} = 90\text{ km/h}$, adjustable live from $8\text{ m/s}$ to $250\text{ m/s}$). Accelerate up to $0.992c$ across a multi-level Grand Prix boulevard, elevated cable-stayed skyway, and city plazas while experiencing exact real-time Special Relativity on both GPU shaders and dual-frame Web Audio.

Zero build step or backend runtime is required—100% static ES modules, WebGL2 shaders, glTF 3D assets, and synthesized Web Audio ready for **GitHub Pages (`github.io`)** or any static file server.

---

## Play Locally

Run the included Python static server (or any static HTTP server serving `./public`):

```bash
python3 server.py --host 127.0.0.1 --port 8080
```

Then open **http://127.0.0.1:8080** in any modern WebGL2 browser.

---

## Controls

| Input | Action |
| :--- | :--- |
| `W` / `Up` | Accelerate forward (relativistic momentum impulse $\tilde{\mathbf{p}} = \gamma \mathbf{v}$) |
| `S` / `Down` | Relativistic brake / reverse |
| `A` / `D` (`Left` / `Right`) | Steer movement heading (camera follows heading unless steered manually) |
| `Shift` | Photon thruster turbo boost |
| `Space` | Drift / handbrake |
| `Mouse Drag` | Look around freely ($360^\circ$ camera decoupled from velocity vector) |
| `V` | Cycle camera view (`Chase` → `Cockpit` → `Hood`) |
| `M` | Toggle in-car synthwave radio (*Lightcone Overdrive*) |
| `R` | Recover upright onto nearest track/skyway centerline |
| `H` | Toggle HUD visibility |

---

## Relativistic Effects Simulated in Real Time

1. **Past-Light-Cone Retardation & Penrose–Terrell Rotation**:
   - Every static and moving vertex is projected onto the observer's past light cone ($t_{\text{emit}} = t_{\text{obs}} - R/c$). Combined with Lorentz contraction, passing 3D billboards, colonnade statues, and Haussmann facades visibly rotate rather than merely flatten, while spinning Ferris wheel spokes, wind turbine blades, and clock hands bend smoothly across emission times.
2. **Relativistic Aberration ("Starbow") & Rest-Frame Radar**:
   - Objects up to $150^\circ+$ behind you in the city frame sweep forward into your forward field of view as $\beta \to 1$, while the bottom-left **Viewer Frame Radar** Lorentz-contracts the circuit and rival cars by $1/\gamma$ along your instantaneous velocity vector.
3. **Calibrated CIE 1931 UV–Visible–SWIR Spectral Doppler Shift & $D^4$ Beaming**:
   - Preserves exact PBR material colors at $D = 1$ while shifting solar daylight, chlorophyll foliage (Near-IR Wood effect), monochromatic $632\text{ nm}$ / $590\text{ nm}$ / $525\text{ nm}$ traffic signals, and invisible-at-rest **$845\text{ nm}$ Near-Infrared speed gates** continuously across Ultraviolet, Visible RGB, and Short-Wave Infrared.
4. **Equivalence Principle / Rindler Turning & Acceleration Optics**:
   - Cornering and longitudinal proper acceleration $\mathbf{a}_{\text{proper}}$ induce Rindler gravitational frequency shifts ($1 + \mathbf{a}\cdot\mathbf{x}/c^2$) and null-geodesic light deflection across the scene.
5. **Relativistic 2-Body Center-of-Momentum Collisions & Twin-Paradox Timing**:
   - Vehicle-to-vehicle impacts conserve relativistic 4-momentum in the Center-of-Momentum frame, and finishing the 3-lap Grand Prix compares **Driver Proper Time ($\tau$)** against **Grandstand City Time ($t$)**—including a solar day/night cycle whose sun races $\gamma\times$ faster across the sky at high $\gamma$.
6. **Dual-Reference-Frame Web Audio**:
   - **In-Car Frame ($\tau$)**: Cockpit synthwave radio (*Lightcone Overdrive*) and muffled exhaust purr play at invariant $1.0\times$ pitch and tempo in your own reference frame.
   - **City Rest Frame ($t$)**: Clock-tower Westminster chimes, plaza street organ, roadside sync beacons, and rival V10 / Shinkansen flybys undergo exact retarded acoustic/optical Doppler pitch & tempo shifts ($D$) and inverse-square attenuation.

---

## Hosting on GitHub Pages (`github.io`)

This repository supports **both** GitHub Pages modes out of the box:
- **GitHub Actions (Recommended)**: In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. Pushing to `main` automatically deploys `./public` via `.github/workflows/deploy-pages.yml` to `https://<username>.github.io/<repo>/`.
- **Deploy from a branch**: Choosing `main` / `/ (root)` also works immediately via `.nojekyll` and the root `index.html` redirect to `./public/`.
