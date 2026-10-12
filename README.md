# Abvy BAC engine

[![CI](https://github.com/Rednegniw/abvy-bac-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Rednegniw/abvy-bac-engine/actions/workflows/ci.yml)

The blood alcohol concentration (BAC) engine used by [Abvy](https://abvy.app), an alcohol tracker for iOS, Android and Wear OS. It is a one-compartment pharmacokinetic model: alcohol is absorbed over time (faster on an empty stomach), distributed through body water, and eliminated by the liver at a saturating rate. Given an evening's drinks and meals, it returns the whole BAC curve.

TypeScript, no runtime dependencies, MIT license.

> [!WARNING]
> The output is an estimate based on population averages, not a measurement, and individuals can differ from it considerably. Do not use it to decide whether you can drive, work, or do anything else that requires you to be sober.

## Features

- BAC at a point in time, or as a curve at any interval
- Each drink's contribution to the curve
- Peak BAC and when it occurs
- When BAC falls below a threshold, such as the time you are sober again
- How long to wait before the next drink to keep the peak under a limit

Inputs are a list of drinks (grams of alcohol, start and end time), optional meals, and the person's sex, weight, height and age.

## How the model works

| Step | Description | Constants |
| --- | --- | --- |
| Intake | Each drink fills its own stomach compartment at a constant rate over its drinking window. | `MIN_POUR_MS` |
| Food | A food state between 0 and 1: the stomach contents at the first drink plus each meal, each decaying with a 2-hour half-life. | `MEAL_LEVEL`, `FOOD_DECAY_LAMBDA` |
| Absorption | First-order, 4.6 per hour on an empty stomach and 1.5 per hour on a full one, interpolated by the food state. | `KA_EMPTY`, `KA_FULL` |
| First-pass loss | Up to 15% of absorbed alcohol, scaled by the food state, never reaches the blood. Calibrated against measured fed-state peaks. | `FIRST_PASS_MAX` |
| Distribution | Total body water from the Watson equations, divided by the water content of blood (0.806). | `BLOOD_WATER_FRACTION` |
| Elimination | Michaelis-Menten, about 0.016 g/dL per hour at typical BAC on an empty stomach and slower below 0.005 g/dL. Food raises it by up to 30%. It runs during absorption as well. | `VMAX_BASE`, `KM`, `VMAX_FOOD_BOOST` |

The equations, the source for each parameter and the validation are in [docs/MODEL.md](docs/MODEL.md).

### Compared with the Widmark formula

Many BAC calculators use Widmark's 1932 formula, which assumes all alcohol is absorbed instantly and then eliminated at a constant rate. It gives a reasonable single estimate, but no rising curve, no effect of food, and a constant slope all the way to zero. This engine models absorption, food and saturating elimination, which are what determine when the peak happens and how long the tail lasts.

## Installation

The package is not published to npm. It is distributed as TypeScript source and works with Bun or any bundler that compiles TypeScript (Abvy uses it with Metro and Vite).

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

Without the meal, the same drinks peak at 0.062 g/dL instead of 0.052.

### Units and conventions

- BAC values are in g/dL (0.08 = 0.08%). Multiply by 10 for g/L; for g/kg, divide g/L by the density of blood, about 1.055.
- Times are Unix timestamps in milliseconds.
- Food is on a 0-1 scale, with presets in `MEAL_LEVEL`: `empty` 0, `light` 0.33, `moderate` 0.67, `full` 1. `initialFoodLevel` describes the stomach at the first drink and defaults to `light`. Entries in `meals`, including meals before the first drink, are added on top of it (capped at 1), so put each meal in one place only.
- `SOBER_THRESHOLD_GDL` (0.001) is the level treated as sober. `EFFECTIVELY_ZERO_BAC_GDL` (0.0005) is a stricter level for treating alcohol as fully cleared.
- Inputs are not validated. The Watson equations apply to adults, and zero or implausible body measurements produce meaningless results.

### API

| Function | Returns |
| --- | --- |
| `bacAt(t, drinks, user, meals?, initialFoodLevel?)` | BAC at `t` |
| `series(startMs, spanMs, stepMs, drinks, user, meals?, initialFoodLevel?)` | The curve as `{ x, y }` points every `stepMs` from `startMs` to `startMs + spanMs` |
| `perDrinkSeries(startMs, spanMs, stepMs, drinks, user, meals?, initialFoodLevel?)` | One curve per drink plus the total, from a single simulation; the per-drink curves sum to the total. Both are empty when there are no drinks |
| `findPeakBacResult(drinks, user, fromMs, meals?, initialFoodLevel?)` | `{ bacGdl, timeMs }` for the highest BAC from `fromMs` onward |
| `findPeakBac(...)` | The same peak as a number |
| `findPeakBacInWindow(drinks, user, fromMs, toMs, meals?, initialFoodLevel?)` | The highest BAC between two times |
| `findSoberTime(drinks, threshold, user, meals?, initialFoodLevel?, { stepMs }?)` | The time BAC last falls to `threshold`; `0` if it never exceeds it; `SOBER_TIME_UNAVAILABLE` (-1) if there is no crossing within 30 days |
| `calculateTimeWhenBelowThreshold(drinks, threshold, user, now?, meals?, initialFoodLevel?)` | A `Date` when BAC falls to `threshold` after `now`, or `null` if it is already there or there is no crossing within 30 days. With several crossings (drinks still to come), use `findSoberTime` |
| `calculateTimeToNextDrink(drinks, user, limit, grams, minutes, now?, meals?, initialFoodLevel?)` | `null` if the drink can start now, the Unix ms time it can start, or `Infinity` if BAC is already at the limit or no start in the next 12 hours keeps the peak under it |
| `calculateTBW(user, atTime?)`, `watsonTbw(sex, age, heightCm, weightKg)` | Total body water in liters |
| `maxBacClearanceMs(user)` | An upper bound on how long any plausible BAC takes to clear |

Optional `now` and `atTime` arguments default to `Date.now()`. All model constants are exported; the Watson coefficients are inside `watsonTbw`.

### Personal modifiers

`UserProfile` has three multipliers. Set them to 1 for a population-average person, or use the presets:

| Situation | Setting |
| --- | --- |
| Women | `fpFactor: FP_FACTOR_FEMALE` (0.8), for lower gastric first-pass metabolism |
| Bariatric surgery | `kaMultiplier: KA_MULTIPLIER_BARIATRIC` (1.5) and `fpFactor: FP_FACTOR_BARIATRIC` (0) |
| GLP-1 receptor agonists (semaglutide, tirzepatide and others) | `kaMultiplier: KA_MULTIPLIER_GLP1` (0.5), for slower gastric emptying |
| Liver condition | `metabolicFactor` capped at `LIVER_CONDITION_CAP` (0.85) |
| Uncertainty range | Run again with `metabolicFactor` multiplied by `SLOW_METABOLIZER_FACTOR` (0.8) and by `FAST_METABOLIZER_FACTOR` (1.2) |

Multipliers combine by multiplication. The bariatric, GLP-1 and liver presets are based on small studies or on assumptions; [docs/MODEL.md](docs/MODEL.md#parameters) gives the basis for each, and the bariatric preset underestimates measured peaks. Abvy can also fit `metabolicFactor` and `kaMultiplier` to a user's breathalyzer readings; that calibration is part of the app, not this package.

## Accuracy

The engine is validated against Jones & Jönsson (1994), in which ten men drank 0.80 g/kg of ethanol once after an overnight fast and once right after breakfast. Mean peak BAC was 104 mg/dL fasted and 67 mg/dL fed. For a representative subject the engine gives:

| | Measured mean | Engine | Difference |
| --- | --- | --- | --- |
| Fasted | 0.104 g/dL | 0.094 g/dL | -9% |
| Fed | 0.067 g/dL | 0.068 g/dL | +1% |

The fed-state parameters were fitted to the fed arm, so that agreement is expected. The fasted peak is 9% low. On the falling part of the curve the engine eliminates about 0.016 g/dL per hour on an empty stomach; Jones (2010) gives 0.015 g/dL/h as a typical population value and 0.010-0.015 g/dL/h as the fasted range.

Main limitations ([details](docs/MODEL.md#limitations)):

- For an average person drinking on an empty stomach, estimates are probably too low. Abvy shows an uncertainty range by default; its upper edge reduces the gap but does not remove it.
- Elimination rates vary several-fold between people and from day to day. The 80%/120% range is a sensitivity band, not a confidence interval.
- Peaks after bariatric surgery are underestimated, because a one-compartment model cannot reproduce the early arterial peak seen in those patients.
- Drinks are described only by grams of alcohol and meals only by size. Beverage type, concentration, carbonation and meal composition are not modeled.
- BAC is not a measure of impairment.

## Development

```sh
bun install
bun test
bunx tsc --noEmit
```

Performance tests report the mean of many calls and are skipped when `CI` is set. `test/readme.test.ts` checks that the outputs quoted in the usage example match the engine.

Functions marked `'worklet'` also run as react-native-worklets in the Abvy app. Elsewhere the directive has no effect.

## Source and contributing

This repository is mirrored automatically from the engine package in Abvy's private app repository. Abvy also has Swift and Kotlin ports of the engine for iOS widgets, Live Activities and Wear OS, kept consistent with it by differential tests in the app repository.

Issues and pull requests are welcome. Accepted changes are made in the app repository and reach this one through the mirror.

The most useful contribution is measured data. Validation currently relies on a single study of ten men, and published BAC curves, especially for women and for evenings with several drinks and food, would extend it. When opening an issue, please include the citation; the subjects' sex, weight, height and age (or group means); the dose and drinking time of each drink; what was eaten and when; and the measured curve or peak.

## License

[MIT](LICENSE). Provided as is, without warranty of any kind. Not a medical device.
