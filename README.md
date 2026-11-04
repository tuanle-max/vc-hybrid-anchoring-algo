# Algorand Verifiable Credential Hybrid Anchoring Algorithm (VC-Hybrid-Anchoring-Algo)

This repository contains the experimental implementation and evaluation suite for our paper on epoch-based decentralized status commitments and verifiable credential (VC) anchoring on the Algorand Mainnet.

It compares:
- **Baseline 0 (B0)**: A fully centralized, signature-based VC verification system.
- **Baseline 1 (B1)**: Standard on-chain token ownership (ASAs representing credentials) with freeze/unfreeze controls.
- **Baseline 2 (B2)**: The proposed decoupled architecture utilizing off-chain W3C VCs, did:key cryptography, and batch-anchored Merkle roots on the Algorand blockchain.
- **Baseline 6 (B6)**: A smart-contract-based batch status commitment model storing the Merkle root in the contract's Global State.

---
## Dataset Information

- `data/algo-usd-max.csv`: Historical daily price index for ALGO/USD spanning from 2019 to 2026 (from Coingecko https://www.coingecko.com/en/coins/algorand/historical_data), utilized for the Monte Carlo cost predictability bootstrapping simulation.
- `data/mainnet\_logs/`: Contains raw output logs, aggregated CSV metrics, and figures generated during benchmark executions.

## Repository Structure

```text
├── benchmarks/                  # Evaluator and benchmarking scripts
│   ├── ablation_benchmark.ts    # Cache hit/miss ablation study
│   ├── baseline_comparison.ts   # B2 vs. B6 smart contract comparative analysis
│   ├── granular_latency_benchmark.ts # Verification sub-component measurements
│   ├── latency_throughput.ts    # Cohort latency profiling (N = 25..500)
│   ├── monte_carlo.py           # Cost predictability bootstrapping simulation & sensitivity matrix
│   └── revocation_test.ts       # Integrity correctness verification (FAR/FRR)
├── data/
│   ├── algo-usd-max.csv         # Historical daily price index for ALGO/USD (2019-2026)
│   └── mainnet_logs/            # Destination directory for all benchmark logs and figures
├── src/
│   ├── b0_centralized/          # Mock Centralized VC system (B0)
│   ├── b1_token_ownership/      # Legacy ASA Token-based system (B1)
│   ├── b2_vc_anchoring/         # Proposed decoupled Merkle anchoring system (B2)
│   ├── b6_smart_contract/       # Smart Contract global state batching system (B6)
│   └── shared/                  # Algonode mainnet clients and performance decorators
├── tests/                       # Jest automated testing suite
├── package.json
├── tsconfig.json
└── README.md
```

---

## Prerequisites

1. **Node.js** (v18.x or higher) and **npm**.
2. **Python** (v3.10.x or higher) with scientific libraries:
   ```bash
   pip install pandas numpy matplotlib seaborn
   ```

---

## Setup Instructions

1. **Install Node.js dependencies**:
   ```bash
   npm install
   ```
2. **Compile TypeScript** (Optional):
   ```bash
   npm run build
   ```

*(Note: The mainnet account used in benchmarks is already generated, funded, and pre-configured in the source code scripts for replication ease).*

---

## How to Run the Evaluation Suite

### 1. Functional Correctness Tests (Jest)
Verify the core cryptographic correctness and validation steps of B0, B1, and B2.
```bash
npm test
```

### 2. Cohort Latency Benchmarking (B0, B1, B2)
Measures the transaction confirmation delays, processing times, and fees across cohorts of sizes $N \in [25, 50, 100, 250, 500]$.
```bash
npm run benchmark:latency
```
- **Output CSV**: `data/mainnet_logs/latency_metrics.csv`

### 3. Revocation & Accuracy Profile (FAR/FRR)
Simulates $1,000$ credentials, revoking a subset of $300$, anchoring state transitions, and checking correctness parameters.
```bash
npm run benchmark:revocation
```
- **Output CSV**: `data/mainnet_logs/far_frr_metrics.csv`

### 4. Smart Contract Comparative Study (B2 vs. B6)
Deploys a TEAL smart contract on Mainnet, runs 10 state update calls, and contrasts latency and fees against standard B2 notes.
```bash
npm run benchmark:comparison
```
- **Output CSV**: `data/mainnet_logs/b6_vs_b2_metrics.csv`

### 5. Granular Latency Profile
Deconstructs verification time into local CPU crypto processing time ($T_{\text{crypto}}$) vs. network transaction retrieval ($T_{\text{network}}$) across 100 credentials.
```bash
npm run benchmark:granular
```
- **Output CSV**: `data/mainnet_logs/granular_latency.csv`

### 6. Caching Ablation Study
Compares verification of $500$ credentials with the `txNoteCache` decorator enabled vs. disabled (forcing network request loops).
```bash
npm run benchmark:ablation
```
- **Output CSV**: `data/mainnet_logs/ablation_study.csv`

### 7. Cost Predictability Bootstrapping & Sensitivity Analysis
Runs a 10,000-iteration bootstrapping Monte Carlo simulation using historical daily prices (`algo-usd-max.csv`) and constructs a multi-variable sensitivity cost matrix across volumes ($1k$ to $1M$ VCs) and update frequencies.
```bash
npm run benchmark:simulation
```
- **Output CSVs**: 
  - `data/mainnet_logs/monte_carlo_results.csv`
  - `data/mainnet_logs/sensitivity_analysis.csv`
- **Output Figure**: `data/mainnet_logs/figure3_cost_distribution.png`
- **Output LaTeX Table**: Prints directly to the console terminal.
