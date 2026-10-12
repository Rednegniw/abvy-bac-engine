# The model

The engine is a one-compartment pharmacokinetic model of blood alcohol concentration. Each drink has its own stomach compartment with first-order absorption; a time-varying food state controls absorption speed, first-pass loss and an increase in elimination; the volume of distribution comes from total body water; elimination follows Michaelis-Menten kinetics. This page covers the equations, the source of each parameter, the numerical method, and validation against measured data.

## Equations

Times are in hours, amounts in grams, concentrations in g/L of blood.

### Volume of distribution

Total body water from the Watson equations (age taken at the first drink), divided by the water fraction of blood:

```
TBW (male)   = 2.447 - 0.09516 * age + 0.1074 * height_cm + 0.3362 * weight_kg
TBW (female) = -2.097 + 0.1069 * height_cm + 0.2466 * weight_kg
V = TBW / 0.806
```

### Food state

A number between 0 (empty stomach) and 1 (full). The stomach contents at the first drink, F0, and each meal j of size L_j eaten at t_j decay exponentially:

```
F(t) = min(1, F0 * exp(-λ (t - t0)) + Σ_{t_j <= t} L_j * exp(-λ (t - t_j))),   λ = 0.347 / h
```

t0 is the start of the first drink. Meals eaten before t0 are added on top of F0, so each meal should be counted either in F0 (`initialFoodLevel`) or in the meal list.

### Intake and absorption

Drink i delivers A_i grams at a constant rate over its pour window P_i (at least one minute) into its stomach compartment S_i. All compartments are absorbed at the same rate:

```
ka(t) = kaMultiplier * (KA_EMPTY - (KA_EMPTY - KA_FULL) * F(t))
dS_i/dt = A_i / P_i (while pouring) - ka(t) * S_i
```

### Blood

Part of the absorbed alcohol is lost to first-pass metabolism, which increases with food. Elimination is saturable:

```
f_sys(t) = 1 - FIRST_PASS_MAX * fpFactor * F(t)
Vmax(t)  = VMAX_BASE * metabolicFactor * (1 + VMAX_FOOD_BOOST * F(t))
C = B / V
dB/dt = f_sys(t) * ka(t) * Σ S_i  -  V * Vmax(t) * C / (KM + C)
BAC (g/dL) = C / 10
```

Elimination starts as soon as there is alcohol in the blood and continues while later drinks are still being absorbed; there are no separate absorption and elimination phases.

### Per-drink curves

`perDrinkSeries` tracks each drink's share of B separately and splits each step's elimination between drinks in proportion to those shares, so the per-drink curves sum to the total.

## Parameters

All constants below are exported, except the Watson coefficients (inside `watsonTbw`) and the clearance bound (inside `maxBacClearanceMs`). "Calibrated" means fitted so that the engine reproduces measured data; "assumption" means no study determines the value.

| Constant | Value | Basis |
| --- | --- | --- |
| `KA_EMPTY` | 4.6 /h | Lee et al. 2013 fitted an absorption rate of 0.0767 /min (4.6 /h) to 2,955 breath samples from 59 people drinking repeatedly. Büsker et al. 2023 list that study among fed-state estimates and estimate 3.64 /h fasted (95% CI 2.95-4.68); published fasted values range from 1 to 8 /h. The engine uses the faster value for an empty stomach, which makes the peak earlier and higher. |
| `KA_FULL` | 1.5 /h | Büsker et al. 2023: 1.45 /h in the fed state. |
| `FOOD_DECAY_LAMBDA` | 0.347 /h | Assumption: a 2-hour half-life for the food state. It is of the same order as solid-meal gastric emptying (a median 24% of a low-fat meal is still in the stomach after 2 hours, Tougas et al. 2000), but no study measures how long a meal keeps changing alcohol kinetics. |
| `MEAL_LEVEL` | 0, 0.33, 0.67, 1 | Assumption: meal size mapped linearly onto the food state. |
| `MIN_POUR_MS` | 60 s | Numerical: a drink poured faster than this is spread over one minute, so it enters the stomach at a finite rate. |
| `FIRST_PASS_MAX` | 0.15 | Calibrated together with `VMAX_FOOD_BOOST` to the fed arm of Jones & Jönsson 1994. How much first-pass metabolism exists is disputed: about 9% in men and 8% in women (Ammon et al. 1996), 7-36% with a meal depending on dose (Levitt 2002), "essentially negligible" in Büsker et al. 2023, who attribute most of the food effect to faster elimination. Read it as an empirical term that carries part of the food effect. |
| `VMAX_FOOD_BOOST` | 0.3 | Food speeds up elimination: by 25% and 45% on average in two alcohol-clamp studies (Ramchandani et al. 2001) and 1.39-fold in Büsker et al. 2023. Calibrated with `FIRST_PASS_MAX`. |
| `VMAX_BASE` | 0.17 g/L/h | In the range of published maximum elimination rates: 0.232 g/L/h from intravenous infusions (Wilkinson et al. 1976), 8.5 g/h per 70 kg (Holford 1987, about 0.16 g/L/h for a 70 kg man's volume here). At a typical BAC it gives about 0.016 g/dL per hour on an empty stomach, against 0.010-0.015 g/dL/h for fasted drinkers and 0.015-0.020 g/dL/h after food in Jones 2010, who calls 0.015 "a good average value". It sits at the fast end; see [Limitations](#limitations). |
| `KM` | 0.05 g/L | Within published values: 0.05-0.1 g/L for alcohol dehydrogenase (Norberg et al. 2003), 0.082 g/L (Wilkinson et al. 1976), 0.085 g/L in venous blood (Büsker et al. 2023). |
| `BLOOD_WATER_FRACTION` | 0.806 | The water content of whole blood conventionally used in BAC estimation, roughly a fraction by mass. Per volume of blood (density about 1.055 g/mL) it would be about 0.85, which would make the volume about 5% smaller and every BAC about 5% higher; see [Limitations](#limitations). |
| Watson equations | | Watson et al. 1980, fitted to dilution measurements of total body water in 458 men and 265 women. |
| `FP_FACTOR_FEMALE` | 0.8 | Frezza et al. 1990 measured women's first-pass metabolism at 23% of men's in non-alcoholic subjects; Ammon et al. 1996 found no sex difference (9.1% vs 8.4% of the dose). 0.8 sits between the two. |
| `KA_MULTIPLIER_BARIATRIC`, `FP_FACTOR_BARIATRIC` | 1.5, 0 | After sleeve gastrectomy or gastric bypass, women reached about twice the peak BAC of women before surgery, and sooner (Acevedo et al. 2018; Pepino et al. 2015); an independent study found 1.28 times (Klockhoff et al. 2002). These presets understate that; see [Limitations](#limitations). |
| `KA_MULTIPLIER_GLP1` | 0.5 | Assumption. In one non-randomized pilot (Quddos et al. 2025, 10 users of semaglutide, liraglutide or tirzepatide and 10 controls, breath alcohol only), alcohol rose more slowly in the GLP-1 group. No study has measured an absorption rate for alcohol on these drugs. |
| `LIVER_CONDITION_CAP` | 0.85 | A precaution, not a measured effect: Dam et al. 2009 found similar maximum elimination rates in 6 recently drinking patients with alcoholic cirrhosis and 6 healthy subjects. Capping the rate lengthens the estimated time to sober. |
| `SLOW_METABOLIZER_FACTOR`, `FAST_METABOLIZER_FACTOR` | 0.8, 1.2 | An illustrative spread of elimination rates, not a confidence interval. The physiological range is far wider, 10 to 35 mg/100 mL per hour (Jones 2010). |
| Clearance bound in `maxBacClearanceMs` | 0.6 g/dL | A numerical sanity bound, not a physiological limit. Among 693 deaths from acute alcohol poisoning, the median femoral-blood BAC was 0.36 g/dL and the range 0.074-0.68 g/dL (Jones & Holmgren 2003); survival after 1.5 g/dL has been reported (O'Neill et al. 1984). |

## Numerical method

The equations are integrated with a fixed-step explicit (forward Euler) method. Single values (`bacAt`, `findPeakBacInWindow`, and `findSoberTime` by default) use 15-second steps; curves and the peak search use 60-second steps, or the requested sampling step if it is finer.

- Alcohol poured during a step has only been in the stomach for part of that step, so it is absorbed at half weight (trapezoid rule). This keeps the absorbed amount of a short pour independent of the step size.
- A step never absorbs more than the stomach holds.
- Stretches where nothing is pouring, every stomach is empty and blood alcohol is below 1e-10 g (about 2e-13 g/dL) are treated as zero and skipped until the next drink.
- Each sample holds the state at its own timestamp, before the step that follows it is integrated.
- `series` and `perDrinkSeries` integrate on a grid that starts at the first drink (or at `startMs`, if that is earlier) and report, for each requested time, the latest integrated sample at or before it. When `startMs` falls between grid points of an evening that is already under way, samples can lag by up to one integration step (60 s).

`test/convergence.test.ts` compares both step sizes with a 1-second integration of the same equations. It covers a single shot, a mixed evening and ten drinks over five hours, for an average man and a fast-absorbing profile, on empty, light and full stomachs.

| Step | Tested bound: peak, any sample, sober time | Worst case measured |
| --- | --- | --- |
| 15 s | 0.5%, 0.0005 g/dL, 1 min | 0.3%, 0.0003 g/dL, 35 s |
| 60 s | 1.5%, 0.0015 g/dL, 2.5 min | 1.3%, 0.0013 g/dL, 2 min |

With 60-second steps the sober time tends to come out slightly early, because explicit steps over-eliminate a little on a falling curve. Abvy only uses them where times are shown to the minute.

## Validation

### Measured people

In Jones & Jönsson 1994, ten healthy men drank 0.80 g/kg of ethanol once after an overnight fast and once immediately after breakfast. Mean peak BAC was 104 ± 16.5 mg/dL fasted and 67 ± 9.5 mg/dL fed. `test/validation.test.ts` reproduces this with 60 g of ethanol drunk over 20 minutes by a 75 kg, 178 cm, 34-year-old man, all multipliers at 1, no meal events, and `initialFoodLevel` 0 (fasted) or 1 (fed). The peak is read from `bacAt` every 30 seconds. The abstract does not report body measurements or drinking time, so those values are assumed.

| | Measured mean | Engine | Difference |
| --- | --- | --- | --- |
| Fasted | 0.104 g/dL | 0.094 g/dL | -9% |
| Fed | 0.067 g/dL | 0.068 g/dL | +1% |

`FIRST_PASS_MAX` and `VMAX_FOOD_BOOST` were fitted to the fed arm, so the fed result is not an independent check. The fasted peak is 9% low. The tests require both peaks to stay within ±15% of the measured means, so a parameter change that moves the engine away from the data fails the suite.

On the falling part of the curve the engine eliminates about 0.016 g/dL per hour on an empty stomach. Jones 2010 gives 0.015 g/dL/h as a typical population value.

### Behavior

The test suite also checks qualitative behavior: doubling the dose roughly doubles the peak (saturable elimination keeps the ratio from being exact), a 60 kg woman reaches a higher BAC than an 80 kg man from the same drink, a full stomach gives a lower peak, a meal eaten after drinking lowers the remaining peak, a shot peaks higher than the same alcohol sipped over 30 minutes, elimination slows at low BAC, and a months-old drink contributes exactly nothing today.

## Limitations

In rough order of importance:

1. Estimates are probably too low for an average person drinking on an empty stomach. Three factors point that way: the fasted peak is 9% below the Jones & Jönsson mean, elimination is at the fast end of the published ranges, and `BLOOD_WATER_FRACTION` is a by-mass value (a by-volume value would give about 5% higher BAC). The slow edge of the uncertainty range (elimination at 80%) reduces the fasted-peak gap from 9.3% to 6.7%.
2. Peaks after bariatric surgery are underestimated. Across both sexes, body weights of 55-100 kg and single drinks of 14-42 g, the bariatric presets raise the peak by 4-12% on an empty stomach and 23-53% after food. Measured increases are about 2 times in two studies from one group and 1.28 times in an independent study. Part of the measured increase is arterial blood peaking before alcohol has distributed through the body, which a one-compartment model cannot produce with any absorption rate. Treat bariatric estimates as a lower bound.
3. The GLP-1 preset is based on one small pilot study. Over the same range of people and doses it lowers the predicted peak by 10-26% on an empty stomach and 17-38% after food; if the real effect is smaller, estimates for these users are too low.
4. A single food state drives absorption, first-pass loss and the elimination increase, all with the same 2-hour decay. Büsker et al. 2023 found no significant decline of the elimination increase over time, so it may last longer than modeled.
5. The model has one compartment. Population fits are better with two (Büsker et al. 2023), and arterial, venous and capillary concentrations differ during absorption (Norberg et al. 2003; Büsker et al. 2023).
6. Drinks are described only by grams of alcohol and meals only by size. Beverage type, concentration, carbonation and meal composition are not modeled; Jones et al. 1997 measured peaks of 13.3-17.7 mg/dL after different meals against 30.8 mg/dL fasted for the same small dose.
7. Parameters are population averages. Elimination rates vary several-fold between people and from day to day. Abvy can fit `metabolicFactor` and `kaMultiplier` to a user's breathalyzer readings; that calibration is not part of this package.
8. Sex selects one of the two Watson equations, which were fitted separately for men and women. For body compositions between the two, both can be tried.
9. Validation relies on one study of ten men. Data for women and for realistic evenings with several drinks would improve it; the README describes what to send.
10. Inputs are not validated. The Watson equations describe adults, and zero or implausible body measurements give meaningless results rather than errors.
11. BAC is not impairment. The engine says nothing about tolerance, reaction time or fitness to drive.

## References

- Acevedo MB, Eagon JC, Bartholow BD, Klein S, Bucholz KK, Pepino MY. Sleeve gastrectomy surgery: when 2 alcoholic drinks are converted to 4. *Surg Obes Relat Dis.* 2018;14(3):277-283. [PubMed 29305304](https://pubmed.ncbi.nlm.nih.gov/29305304/)
- Ammon E, Schäfer C, Hofmann U, Klotz U. Disposition and first-pass metabolism of ethanol in humans: is it gastric or hepatic and does it depend on gender? *Clin Pharmacol Ther.* 1996;59(5):503-513. [PubMed 8646821](https://pubmed.ncbi.nlm.nih.gov/8646821/)
- Büsker S, Jones AW, Hahn RG, Taubert M, Klotz U, Schwab M, Fuhr U. Population pharmacokinetics as a tool to reevaluate the complex disposition of ethanol in the fed and fasted states. *J Clin Pharmacol.* 2023;63(6):681-694. [doi:10.1002/jcph.2205](https://doi.org/10.1002/jcph.2205)
- Dam G, Sørensen M, Munk OL, Keiding S. Hepatic ethanol elimination kinetics in patients with cirrhosis. *Scand J Gastroenterol.* 2009;44(7):867-871. [PubMed 19404864](https://pubmed.ncbi.nlm.nih.gov/19404864/)
- Frezza M, di Padova C, Pozzato G, Terpin M, Baraona E, Lieber CS. High blood alcohol levels in women: the role of decreased gastric alcohol dehydrogenase activity and first-pass metabolism. *N Engl J Med.* 1990;322(2):95-99. [doi:10.1056/NEJM199001113220205](https://doi.org/10.1056/NEJM199001113220205)
- Holford NH. Clinical pharmacokinetics of ethanol. *Clin Pharmacokinet.* 1987;13(5):273-292. [PubMed 3319346](https://pubmed.ncbi.nlm.nih.gov/3319346/)
- Jones AW. Evidence-based survey of the elimination rates of ethanol from blood with applications in forensic casework. *Forensic Sci Int.* 2010;200(1-3):1-20. [PubMed 20304569](https://pubmed.ncbi.nlm.nih.gov/20304569/)
- Jones AW, Holmgren P. Comparison of blood-ethanol concentration in deaths attributed to acute alcohol poisoning and chronic alcoholism. *J Forensic Sci.* 2003;48(4):874-879. [PubMed 12877310](https://pubmed.ncbi.nlm.nih.gov/12877310/)
- Jones AW, Jönsson KA. Food-induced lowering of blood-ethanol profiles and increased rate of elimination immediately after a meal. *J Forensic Sci.* 1994;39(4):1084-1093. [PubMed 8064267](https://pubmed.ncbi.nlm.nih.gov/8064267/)
- Jones AW, Jönsson KA, Kechagias S. Effect of high-fat, high-protein, and high-carbohydrate meals on the pharmacokinetics of a small dose of ethanol. *Br J Clin Pharmacol.* 1997;44(6):521-526. [PubMed 9431825](https://pubmed.ncbi.nlm.nih.gov/9431825/)
- Klockhoff H, Näslund I, Jones AW. Faster absorption of ethanol and higher peak concentration in women after gastric bypass surgery. *Br J Clin Pharmacol.* 2002;54(6):587-591. [PubMed 12492605](https://pubmed.ncbi.nlm.nih.gov/12492605/)
- Lee BY, Yoon HK, Baek IH, Kwon KI. Population pharmacokinetics of multiple alcohol intake in humans. *Alcohol.* 2013;47(2):159-165. [doi:10.1016/j.alcohol.2012.12.012](https://doi.org/10.1016/j.alcohol.2012.12.012)
- Levitt DG. PKQuest: measurement of intestinal absorption and first pass metabolism - application to human ethanol pharmacokinetics. *BMC Clin Pharmacol.* 2002;2:4. [doi:10.1186/1472-6904-2-4](https://doi.org/10.1186/1472-6904-2-4)
- Norberg A, Jones AW, Hahn RG, Gabrielsson JL. Role of variability in explaining ethanol pharmacokinetics: research and forensic applications. *Clin Pharmacokinet.* 2003;42(1):1-31. [PubMed 12489977](https://pubmed.ncbi.nlm.nih.gov/12489977/)
- O'Neill S, Tipton KF, Prichard JS, Quinlan A. Survival after high blood alcohol levels: association with first-order elimination kinetics. *Arch Intern Med.* 1984;144(3):641-642. [PubMed 6703836](https://pubmed.ncbi.nlm.nih.gov/6703836/)
- Pepino MY, Okunade AL, Eagon JC, Bartholow BD, Bucholz K, Klein S. Effect of Roux-en-Y gastric bypass surgery: converting 2 alcoholic drinks to 4. *JAMA Surg.* 2015;150(11):1096-1098. [PubMed 26244751](https://pubmed.ncbi.nlm.nih.gov/26244751/)
- Quddos F, Fowler M, de Lima Bovo AC, et al. A preliminary study of the physiological and perceptual effects of GLP-1 receptor agonists during alcohol consumption in people with obesity. *Sci Rep.* 2025;15:32385. [doi:10.1038/s41598-025-17927-w](https://doi.org/10.1038/s41598-025-17927-w)
- Ramchandani VA, Kwo PY, Li TK. Effect of food and food composition on alcohol elimination rates in healthy men and women. *J Clin Pharmacol.* 2001;41(12):1345-1350. [doi:10.1177/00912700122012814](https://doi.org/10.1177/00912700122012814)
- Tougas G, Eaker EY, Abell TL, et al. Assessment of gastric emptying using a low fat meal: establishment of international control values. *Am J Gastroenterol.* 2000;95(6):1456-1462. [PubMed 10894578](https://pubmed.ncbi.nlm.nih.gov/10894578/)
- Watson PE, Watson ID, Batt RD. Total body water volumes for adult males and females estimated from simple anthropometric measurements. *Am J Clin Nutr.* 1980;33(1):27-39. [doi:10.1093/ajcn/33.1.27](https://doi.org/10.1093/ajcn/33.1.27)
- Wilkinson PK, Sedman AJ, Sakmar E, Earhart RH, Weidler DJ, Wagner JG. Blood ethanol concentrations during and following constant-rate intravenous infusion of alcohol. *Clin Pharmacol Ther.* 1976;19(2):213-223. [PubMed 1261158](https://pubmed.ncbi.nlm.nih.gov/1261158/)
