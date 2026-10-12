# Abvy BAC engine

[![CI](https://github.com/Rednegniw/abvy-bac-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Rednegniw/abvy-bac-engine/actions/workflows/ci.yml)

The blood alcohol concentration (BAC) engine behind [Abvy](https://abvy.app), an alcohol tracker for iOS, Android and Wear OS. It is a one-compartment pharmacokinetic model: alcohol is absorbed over time (faster on an empty stomach), spreads through your body water, and is broken down by the liver at a rate that saturates. It gives a full curve for an evening, not just one number.

Pure TypeScript, no runtime dependencies, MIT licensed.

> [!WARNING]
> This is an estimate from population averages, not a measurement. Real people differ from it, sometimes by a lot. Never use it to decide whether you can drive, work, or do anything else that needs you sober. If in doubt, don't.

## What it computes

- BAC at any moment, or as a curve sampled at any interval
- each drink's share of that curve
- the peak, and when it happens
- when BAC falls below a threshold (for example, when you are sober again)
- how long to wait before a next drink so the peak stays under a limit

All from a list of drinks (grams of alcohol, start and end time), optional meals, and a person's sex, weight, height and age.

## The model in one picture

```
drink ──pour──▶ stomach ──absorption ka(F)──▶ blood ──Michaelis-Menten──▶ eliminated
                                │
                                └──▶ first-pass loss (up to 15% when fed)
```

| Step | What happens | Main parameters |
| --- | --- | --- |
| Intake | Each drink fills its own stomach compartment at a constant rate over its drinking window. | |
| Absorption | First-order, from 4.6 per hour on an empty stomach down to 1.5 per hour on a full one. | `KA_EMPTY`, `KA_FULL` |
| Food | A food state F(t) between 0 and 1: the stomach at the first drink plus every meal, each fading with a 2-hour half-life. It sets the absorption rate, the first-pass loss and a fed-state boost to elimination. | `MEAL_LEVEL`, `FOOD_DECAY_LAMBDA` |
| First-pass loss | Up to 15% of absorbed alcohol never reaches the blood, scaled by F(t). Calibrated against measured fed-state peaks. | `FIRST_PASS_MAX` |
| Distribution | Body water from the Watson equations, scaled up to its blood equivalent (the conventional 80.6% water content of blood). | `BLOOD_WATER_FRACTION` |
| Elimination | Michaelis-Menten: about 0.016 g/dL per hour at a typical BAC on an empty stomach, slowing below 0.005 g/dL; up to 30% faster after food. Elimination runs during absorption too. | `VMAX_BASE`, `KM`, `VMAX_FOOD_BOOST` |

The full equations, every parameter with its source, and the validation are in [docs/MODEL.md](docs/MODEL.md).

### How it differs from the Widmark formula

Many BAC calculators use Widmark's 1932 formula: all alcohol is absorbed at once, then BAC falls in a straight line. That is fine for a rough number after the fact, but it has no rising curve, ignores food, and keeps the same slope down to zero. This engine models absorption, food and saturating elimination explicitly, so the shape of an evening (when you peak, how long the tail lasts) comes out of the model rather than being assumed.

## Install

The package is not on npm. It ships as TypeScript source, so use it from Bun or through a bundler that compiles TypeScript; Abvy itself consumes it through Metro (React Native) and Vite.

```sh
bun add github:Rednegniw/abvy-bac-engine
```

## Usage

```ts
import {
    bacAt,
    calculateTimeToNextDrink,
    type Drink,
    FP_FACTOR_FEMALE,
    findPeakBacResult,
    findSoberTime,
    type MealEvent,
    MEAL_LEVEL,
    SOBER_THRESHOLD_GDL,
    series,
    type UserProfile
} from '@abvy/bac'

const me: UserProfile = {
    sex: 'female',
    weightKg: 64,
    heightCm: 168,
    birthday: Date.UTC(1995, 3, 12),
    metabolicFactor: 1,
    kaMultiplier: 1,
    fpFactor: FP_FACTOR_FEMALE
}

const t0 = Date.UTC(2026, 9, 10, 19, 0) // 19:00 UTC
const min = (m: number) => m * 60_000

// Grams of alcohol = milliliters x ABV x 0.789
const drinks: Drink[] = [
    { alcoholGrams: 20, start: t0, end: t0 + min(30) }, // 500 ml of 5% beer
    { alcoholGrams: 14, start: t0 + min(45), end: t0 + min(75) } // 175 ml of 10% wine
]
const meals: MealEvent[] = [{ timeMs: t0 + min(20), level: MEAL_LEVEL.moderate }]
const stomachAtFirstDrink = MEAL_LEVEL.empty

bacAt(t0 + min(90), drinks, me, meals, stomachAtFirstDrink)
// 0.0508 g/dL at 20:30

findPeakBacResult(drinks, me, t0, meals, stomachAtFirstDrink)
// { bacGdl: 0.0517, timeMs: 20:40 as Unix ms }

findSoberTime(drinks, SOBER_THRESHOLD_GDL, me, meals, stomachAtFirstDrink)
// 00:52 as Unix ms

series(t0, min(360), min(1), drinks, me, meals, stomachAtFirstDrink)
// 361 points { x: Unix ms, y: g/dL }, one per minute

calculateTimeToNextDrink(drinks, me, 0.06, 14, 30, t0 + min(90), meals, stomachAtFirstDrink)
// 21:26 as Unix ms: a 14 g drink sipped over 30 minutes from then peaks at 0.06
```

Without the meal, the same two drinks peak at 0.062 instead of 0.052.

### Units

- Every BAC is in **g/dL** (0.08 means 0.08%). Multiply by 10 for g/L. For g/kg, divide g/L by the density of blood, about 1.055.
- Every time is a Unix timestamp in **milliseconds**.
- Food is on a **0 to 1** scale; `MEAL_LEVEL` has the presets (`empty` 0, `light` 0.33, `moderate` 0.67, `full` 1). `initialFoodLevel` is the stomach at the first drink and defaults to `light`. Meals passed in `meals` add on top of it (clamped at 1), including meals before the first drink, so count a meal in one place or the other, not both.
- `SOBER_THRESHOLD_GDL` (0.001) is the level treated as sober; `EFFECTIVELY_ZERO_BAC_GDL` (0.0005) is a tighter level for deciding that alcohol has cleared completely.
- Inputs are not validated. The Watson equations are for adults; zero or implausible body sizes give meaningless results.

### API

| Function | Returns |
| --- | --- |
| `bacAt(t, drinks, user, meals?, initialFoodLevel?)` | BAC at `t` |
| `series(startMs, spanMs, stepMs, drinks, user, meals?, initialFoodLevel?)` | The curve, one `{ x, y }` every `stepMs` from `startMs` to `startMs + spanMs` |
| `perDrinkSeries(startMs, spanMs, stepMs, drinks, user, meals?, initialFoodLevel?)` | One curve per drink plus the total; the per-drink curves add up to the total (both empty when there are no drinks) |
| `findPeakBacResult(drinks, user, fromMs, meals?, initialFoodLevel?)` | `{ bacGdl, timeMs }` of the highest BAC from `fromMs` on |
| `findPeakBac(...)` | The same peak, as a number |
| `findPeakBacInWindow(drinks, user, fromMs, toMs, meals?, initialFoodLevel?)` | The highest BAC between two times |
| `findSoberTime(drinks, threshold, user, meals?, initialFoodLevel?, { stepMs }?)` | When BAC finally falls to `threshold`; `0` if it never exceeds it; `SOBER_TIME_UNAVAILABLE` (-1) if no crossing within 30 days |
| `calculateTimeWhenBelowThreshold(drinks, threshold, user, now?, meals?, initialFoodLevel?)` | A `Date` when BAC falls to `threshold` after `now`, or `null` if it already is or no crossing is found within 30 days. If BAC crosses more than once (drinks still to come), prefer `findSoberTime` |
| `calculateTimeToNextDrink(drinks, user, limit, grams, minutes, now?, meals?, initialFoodLevel?)` | `null` if the drink can start now, a Unix ms time to wait for, or `Infinity` if BAC is already at the limit or no start in the next 12 hours keeps the peak under it |
| `calculateTBW(user, atTime?)`, `watsonTbw(sex, age, heightCm, weightKg)` | Total body water in liters |
| `maxBacClearanceMs(user)` | A generous bound on how long any plausible BAC takes to clear |

Optional `now` and `atTime` arguments default to `Date.now()`. The model's constants are exported (the Watson coefficients live in `watsonTbw`), so you can show or test exactly what the engine assumes.

### Personal modifiers

`UserProfile` carries three multipliers. Leave them at 1 for a population-average person, or apply the presets:

| Situation | Setting |
| --- | --- |
| Women | `fpFactor: FP_FACTOR_FEMALE` (0.8): lower gastric first-pass metabolism |
| Bariatric surgery | `kaMultiplier: KA_MULTIPLIER_BARIATRIC` (1.5) and `fpFactor: FP_FACTOR_BARIATRIC` (0) |
| GLP-1 receptor agonists (semaglutide, tirzepatide, ...) | `kaMultiplier: KA_MULTIPLIER_GLP1` (0.5): slower gastric emptying |
| Liver condition | `metabolicFactor` capped at `LIVER_CONDITION_CAP` (0.85) |
| Uncertainty range | rerun with `metabolicFactor` x `SLOW_METABOLIZER_FACTOR` (0.8) and x `FAST_METABOLIZER_FACTOR` (1.2) |

Combine multipliers by multiplying them. The bariatric, GLP-1 and liver presets rest on small studies or none; [docs/MODEL.md](docs/MODEL.md#parameters) says exactly what each one is based on, and the bariatric preset understates measured peaks. In Abvy, `metabolicFactor` and `kaMultiplier` can also be personalized from the user's own breathalyzer readings; that calibration lives in the app, not in this package.

## Accuracy

The engine is checked against measured people, not only against itself. In Jones & Jönsson's 1994 crossover study, ten men drank 0.80 g/kg of ethanol once after an overnight fast and once right after breakfast; the mean peak was 104 mg/dL fasted and 67 mg/dL fed. Replaying that dose for a typical subject gives:

| | Measured mean | Engine | Difference |
| --- | --- | --- | --- |
| Fasted | 0.104 g/dL | 0.094 g/dL | -9% |
| Fed | 0.067 g/dL | 0.068 g/dL | +1% |

The fed-state parameters were tuned to that fed arm, so the fed match is by construction; the fasted gap is a genuine miss, in the direction that understates BAC. On the falling curve the engine eliminates about 0.016 g/dL per hour on an empty stomach, close to the 0.015 g/dL/h that Jones (2010) calls a good population average, but at the fast end of the range for fasted drinkers.

The most important limits, all covered in [docs/MODEL.md](docs/MODEL.md#limitations):

- **For an average person on an empty stomach, the estimate likely runs low.** The fasted peak is 9% under the measured mean, and elimination sits at the fast end of the published range. Abvy shows an uncertainty range around every estimate by default; its slow edge narrows that gap but does not close it.
- **People differ.** Elimination rates vary several-fold between healthy adults and from day to day within one person. The 80%/120% range is a sensitivity band, not a confidence interval.
- **Bariatric surgery is understated**, because part of the measured jump comes from arterial blood peaking before alcohol spreads through the body, which a one-compartment model cannot produce.
- **Drinks are just grams and meals are just a size.** Beverage type, concentration, carbonation and meal composition are not modeled.
- **Inputs are trusted.** Nothing is validated, and the body-water equations are only meant for adults.
- **BAC is not impairment.** The engine says nothing about tolerance or fitness to drive.

## Development

```sh
bun install
bun test          # model, numerics, convergence, queries, validation and performance tests
bunx tsc --noEmit
```

Performance budgets are averaged over many calls and skipped when `CI` is set, because shared runners make wall-clock timings unreliable. `test/readme.test.ts` replays the usage example above, so its quoted outputs cannot drift from the engine.

Functions marked `'worklet'` also run on react-native-worklets runtimes inside the Abvy app; everywhere else the directive is an inert string.

## Where this comes from

This repository is an automatic mirror of the engine package in Abvy's (private) app repository, published on every change. Abvy also runs Swift and Kotlin ports of the engine for iOS widgets, Live Activities and Wear OS; differential tests in the app repository hold all three to the same numbers.

Issues and pull requests are welcome. Accepted changes are applied in the app repository and arrive here through the mirror, so a merged pull request may show up as a mirrored commit. Measured data are the most valuable contribution. Validation currently rests on one study of ten men; published BAC curves, especially of women and of realistic evenings with several drinks and food, would widen it. Open an issue with the citation, the subjects' sex, weight, height and age (or group means), the dose and drinking time of each drink, what was eaten and when, and the measured curve or peak.

## License

[MIT](LICENSE). Provided as is, without warranty of any kind. This is not a medical device and must not be used as one.
