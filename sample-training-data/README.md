# Synthetic Edge Impulse gas-classification samples

This folder contains three independent, balanced CSV files, each with **300 samples**: 100 `normal`, 100 `warning`, and 100 `critical`.

| File | Feature | Normal | Warning | Critical |
|---|---|---:|---:|---:|
| `mq4_methane_300_synthetic.csv` | Methane, ppm | 100–1,999.9 | 2,000–2,499.9 | 2,500–6,000 |
| `mq7_carbon_monoxide_300_synthetic.csv` | Carbon monoxide, ppm | 1–39.9 | 40–49.9 | 50–200 |
| `mg811_carbon_dioxide_300_synthetic.csv` | Carbon dioxide, ppm | 400–3,999.9 | 4,000–4,999.9 | 5,000–10,000 |

Thresholds use this project's settings: Warning starts at 80% of the supplied limit; Critical starts at the limit. The CSVs are synthetic concentration examples for practicing a classification workflow, not live sensor recordings, not raw ADC data, and not evidence that the hardware calibration is accurate. The MQ sensors' hardware settings are not configured. MG811's current measured two-point fit only covers 400–1,000 ppm, so its synthetic warning/critical examples are intentionally outside the installed sensor's currently calibrated range. Do not deploy a model trained on these files for real exposure monitoring or safety decisions.

## Import in Edge Impulse

Use one sensor CSV at a time in the project's **Data acquisition → CSV Wizard**. Set **Time-series data** to **No** (each row is one sample); map the sensor's numeric `*_ppm` column as the value/feature, `class` as the label, and `sample_id` / `data_origin` as metadata. Check the preview and ensure the label distribution is 100 per class. These one-feature samples can demonstrate import and classification, but they do not simulate sensor noise, response dynamics, temperature/humidity effects, or the real raw-signal-to-ppm conversion. Train/test results will only show that the model learned the supplied threshold labels.

Threshold basis: methane 2,500 ppm (warning 2,000 ppm), CO 50 ppm (warning 40 ppm), and CO2 5,000 ppm (warning 4,000 ppm), as currently configured in A.R.G.O.S.
