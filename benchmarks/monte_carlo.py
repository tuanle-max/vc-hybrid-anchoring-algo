import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

def run_sensitivity_analysis(prices, start_indices, output_dir):
    volumes = [1000, 10000, 100000, 1000000]
    frequencies = [8760, 365, 52]
    trajectory_len = 365
    iterations = len(start_indices)

    b1_algo_per_cred = 0.004
    b2_algo_per_epoch = 0.001

    results = []

    print("\nRunning Sensitivity Analysis Matrix...")
    print("-----------------------------------------------------------------")
    print(f"{'Volume':<12} | {'Epoch Freq (yr)':<16} | {'B1 p95 (USD)':<14} | {'B2 p95 (USD)':<14}")
    print("-----------------------------------------------------------------")

    # Vectorized sum of trajectory prices for each start index
    sum_traj_prices = np.zeros(iterations)
    for idx, start_idx in enumerate(start_indices):
        sum_traj_prices[idx] = np.sum(prices[start_idx : start_idx + trajectory_len])

    for V in volumes:
        for F in frequencies:
            # B1 cost for each iteration: (V / 365.0) * b1_algo_per_cred * sum_traj_prices
            b1_costs = (V / 365.0) * b1_algo_per_cred * sum_traj_prices
            
            # B2 cost for each iteration: (F / 365.0) * b2_algo_per_epoch * sum_traj_prices
            b2_costs = (F / 365.0) * b2_algo_per_epoch * sum_traj_prices

            b1_p95 = np.percentile(b1_costs, 95)
            b2_p95 = np.percentile(b2_costs, 95)

            freq_desc = f"1 hour ({F}/yr)" if F == 8760 else (f"24 hours ({F}/yr)" if F == 365 else f"7 days ({F}/yr)")
            print(f"{V:<12,} | {freq_desc:<16} | ${b1_p95:<13.4f} | ${b2_p95:<13.4f}")

            results.append({
                'Volume': V,
                'EpochFrequency': F,
                'B1_p95_USD': b1_p95,
                'B2_p95_USD': b2_p95
            })

    print("-----------------------------------------------------------------")

    # Save to CSV
    sens_df = pd.DataFrame(results)
    sens_csv_path = os.path.join(output_dir, 'sensitivity_analysis.csv')
    sens_df.to_csv(sens_csv_path, index=False)
    print(f"Sensitivity analysis matrix saved to {sens_csv_path}")

    # Generate LaTeX table representation
    print("\nLaTeX Table Code:")
    print(r"\begin{table}[h]")
    print(r"\centering")
    print(r"\begin{tabular}{lrrr}")
    print(r"\hline")
    print(r"Volume & Epoch Frequency & B1 p95 Cost (USD) & B2 p95 Cost (USD) \\")
    print(r"\hline")
    for r in results:
        v_str = f"{r['Volume']:,}"
        f_str = "1 hour" if r['EpochFrequency'] == 8760 else ("24 hours" if r['EpochFrequency'] == 365 else "7 days")
        print(f"{v_str} & {f_str} & \\${r['B1_p95_USD']:.4f} & \\${r['B2_p95_USD']:.4f} \\\\")
    print(r"\hline")
    print(r"\end{tabular}")
    print(r"\caption{Sensitivity Analysis comparing B1 and B2 p95 annual USD cost across volume and frequency variations.}")
    print(r"\label{tab:sensitivity_analysis}")
    print(r"\end{table}")

def run_simulation():
    csv_path = 'data/algo-usd-max.csv'
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Historical pricing data not found at {csv_path}")

    # Read and sort data
    df = pd.read_csv(csv_path)
    df['event_date'] = pd.to_datetime(df['event_date'])
    df = df.sort_values('event_date').reset_index(drop=True)

    prices = df['close_price_usd'].values
    n_days = len(prices)

    # Number of simulation iterations
    iterations = 10000
    
    # 365 days of trajectory needed
    trajectory_len = 365
    max_start_idx = n_days - trajectory_len

    if max_start_idx <= 0:
        raise ValueError("Insufficient data in the dataset for a 365-day simulation.")

    # Seed for reproducibility
    np.random.seed(42)
    
    # Bootstrap random starting indices
    start_indices = np.random.randint(0, max_start_idx, size=iterations)

    daily_volume = 10000 / 365.0
    b1_algo_per_cred = 0.004
    b2_algo_per_epoch = 0.001

    b1_costs = []
    b2_costs = []

    for i in range(iterations):
        start_idx = start_indices[i]
        trajectory = prices[start_idx : start_idx + trajectory_len]

        # Calculate B1 cost
        # Sum of: daily_volume * b1_algo_per_cred * price
        b1_cost_usd = np.sum(daily_volume * b1_algo_per_cred * trajectory)
        
        # Calculate B2 cost
        # Sum of: 1 * b2_algo_per_epoch * price
        b2_cost_usd = np.sum(1.0 * b2_algo_per_epoch * trajectory)

        b1_costs.append(b1_cost_usd)
        b2_costs.append(b2_cost_usd)

    # Convert to df
    results_df = pd.DataFrame({
        'iteration': np.arange(1, iterations + 1),
        'b1_cost_usd': b1_costs,
        'b2_cost_usd': b2_costs
    })

    # Save to CSV
    output_dir = 'data/mainnet_logs'
    os.makedirs(output_dir, exist_ok=True)
    results_csv_path = os.path.join(output_dir, 'monte_carlo_results.csv')
    results_df.to_csv(results_csv_path, index=False)
    print(f"Simulation results saved to {results_csv_path}")

    # Calculate statistics
    stats = {}
    for col, name in [('b1_cost_usd', 'B1 (Legacy Token)'), ('b2_cost_usd', 'B2 (Proposed Decoupled)')]:
        data = results_df[col]
        stats[col] = {
            'Mean': np.mean(data),
            'Median': np.median(data),
            'Min': np.min(data),
            'Max': np.max(data),
            'p95': np.percentile(data, 95)
        }
        print(f"\nDescriptive Statistics for {name}:")
        print(f"  Mean:   ${stats[col]['Mean']:.4f} USD")
        print(f"  Median: ${stats[col]['Median']:.4f} USD")
        print(f"  Min:    ${stats[col]['Min']:.4f} USD")
        print(f"  Max:    ${stats[col]['Max']:.4f} USD")
        print(f"  p95:    ${stats[col]['p95']:.4f} USD")

    # Run sensitivity analysis
    run_sensitivity_analysis(prices, start_indices, output_dir)

    # Generate academic density plot
    plt.figure(figsize=(7, 4.5))
    
    # Use neo-minimalist style: clean background, monochromatic high-contrast styling
    sns.set_theme(style="ticks")
    
    # Plot distributions
    sns.histplot(results_df['b1_cost_usd'], color="#333333", label="B1 (Legacy Token)", kde=True, stat="density", element="step", alpha=0.3, linewidth=1.5)
    sns.histplot(results_df['b2_cost_usd'], color="#888888", label="B2 (Proposed Decoupled)", kde=True, stat="density", element="step", alpha=0.6, linewidth=1.5)
    
    plt.xlabel("Estimated Annual Operational Cost (USD)", fontsize=10, fontweight='bold', labelpad=8)
    plt.ylabel("Probability Density", fontsize=10, fontweight='bold', labelpad=8)
    plt.title("Comparison of Annual Cost USD Distributions (B1 vs. B2)", fontsize=11, fontweight='bold', pad=12)
    
    # Academic style legend and spines
    plt.legend(frameon=True, fontsize=9, loc='upper right')
    sns.despine()
    
    plt.tight_layout()
    plot_path = os.path.join(output_dir, 'figure3_cost_distribution.png')
    plt.savefig(plot_path, dpi=300)
    plt.close()
    print(f"Academic cost distribution plot saved to {plot_path}")

if __name__ == "__main__":
    run_simulation()
