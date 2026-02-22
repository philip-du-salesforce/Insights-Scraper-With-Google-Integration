#!/usr/bin/env python3
"""
Login History Analysis and Map Visualization.

Used by the Insights Scraper: after the extension triggers a Login History CSV
download, this script can run (optionally after a delay) to find the CSV,
analyze it, and produce charts/tables in Login_Analysis_Output/.

Usage:
  python login_analysis.py [--directory DIR] [--delay SECONDS] [--no-browser]
"""

import argparse
import glob
import os
import sys
from pathlib import Path

# Check for dependencies
try:
    import pandas as pd
    import plotly.express as px
    import numpy as np
    import country_converter as coco
except ImportError:
    print("Error: One or more required libraries are not installed.")
    print("Please install them: pip install pandas plotly numpy country_converter")
    sys.exit(1)


# Chart image dimensions: larger size to show more data and readable labels
CHART_WIDTH = 1600
CHART_HEIGHT = 900

# Layout tweaks so bar charts show as many categories as possible (smaller ticks, angled labels)
def _layout_more_categories(fig, x_tick_angle=-45, tick_font_size=10, bottom_margin=140):
    fig.update_layout(
        margin=dict(b=bottom_margin),
        xaxis=dict(tickangle=x_tick_angle, tickfont=dict(size=tick_font_size)),
        yaxis=dict(tickfont=dict(size=tick_font_size)),
        font=dict(size=12),
        showlegend=True,
        legend=dict(font=dict(size=11)),
    )


def analyze_logins(df, output_dir=None, open_browser=True):
    """
    Performs the analysis on the login DataFrame and generates visualizations.
    If open_browser is False, HTML files are written but not opened in the browser.
    """
    if output_dir is None:
        output_dir = "Login_Analysis_Output"
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Saving files to: '{output_dir}'")

    if "Status" not in df.columns:
        print("Warning: 'Status' column not found. Cannot analyze successful/failed logins.")
        return False

    df["Successful Logins"] = np.where(df["Status"] == "Success", 1, 0)
    df["Failed Logins"] = np.where(df["Status"] != "Success", 1, 0)

    def _open(path):
        if open_browser:
            import webbrowser
            webbrowser.open("file://" + str(Path(path).resolve()))

    # --- Part 1: Application Logins ---
    if "Application" in df.columns:
        application_logins = df.groupby("Application").agg(
            Successful_Logins=("Successful Logins", "sum"),
            Failed_Logins=("Failed Logins", "sum"),
        ).reset_index()
        application_logins["Total Logins"] = (
            application_logins["Successful_Logins"] + application_logins["Failed_Logins"]
        )
        application_logins = application_logins[
            ["Application", "Total Logins", "Successful_Logins", "Failed_Logins"]
        ].sort_values(by="Total Logins", ascending=False)

        application_logins_melted = application_logins.melt(
            id_vars="Application",
            value_vars=["Successful_Logins", "Failed_Logins"],
            var_name="Login_Status",
            value_name="Number_of_Logins",
        )
        fig_bar_app = px.bar(
            application_logins_melted,
            x="Application",
            y="Number_of_Logins",
            color="Login_Status",
            barmode="group",
            title="Number of Logins by Application (Successful vs. Failed)",
            text_auto=True,
            color_discrete_map={"Successful_Logins": "green", "Failed_Logins": "red"},
        )
        fig_bar_app.update_layout(xaxis={"categoryorder": "total descending"})
        _layout_more_categories(fig_bar_app)

        bar_chart_app_file = output_dir / "application_logins_chart.html"
        fig_bar_app.write_html(bar_chart_app_file)
        try:
            fig_bar_app.write_image(output_dir / "application_logins_chart.png", width=CHART_WIDTH, height=CHART_HEIGHT)
        except Exception:
            pass
        _open(bar_chart_app_file)
        application_logins.to_csv(output_dir / "application_logins.csv", index=False)
        application_logins.to_html(output_dir / "application_logins_table.html", index=False, border=0)
        _open(output_dir / "application_logins_table.html")

    # --- Part 2: Internal Logins by Country ---
    if "Country" in df.columns and "Application" in df.columns:
        internal_df = df[
            df["Application"].str.strip().str.lower().isin(["browser", "salesforce for ios"])
        ]
        if not internal_df.empty:
            internal_country_logins = internal_df.groupby("Country").agg(
                Successful_Logins=("Successful Logins", "sum"),
                Failed_Logins=("Failed Logins", "sum"),
            ).reset_index()
            internal_country_logins["Total Logins"] = (
                internal_country_logins["Successful_Logins"]
                + internal_country_logins["Failed_Logins"]
            )
            internal_country_logins["iso_alpha"] = coco.convert(
                names=internal_country_logins["Country"],
                src="name_short",
                to="ISO3",
                not_found=None,
            )
            internal_country_logins = internal_country_logins.sort_values(
                by="Total Logins", ascending=False
            )

            fig_map_internal = px.choropleth(
                internal_country_logins,
                locations="iso_alpha",
                color="Total Logins",
                hover_name="Country",
                hover_data=["Successful_Logins", "Failed_Logins"],
                color_continuous_scale=px.colors.sequential.Plasma,
                title="World Map of Internal Logins",
            )
            map_file = output_dir / "internal_country_logins_map.html"
            fig_map_internal.write_html(map_file)
            _open(map_file)

            internal_melted = internal_country_logins.melt(
                id_vars="Country",
                value_vars=["Successful_Logins", "Failed_Logins"],
                var_name="Login_Status",
                value_name="Number_of_Logins",
            )
            fig_bar_internal = px.bar(
                internal_melted,
                x="Country",
                y="Number_of_Logins",
                color="Login_Status",
                barmode="group",
                title="Internal Logins by Country (Successful vs. Failed)",
                text_auto=True,
                color_discrete_map={"Successful_Logins": "green", "Failed_Logins": "red"},
            )
            fig_bar_internal.update_layout(xaxis={"categoryorder": "total descending"})
            _layout_more_categories(fig_bar_internal)

            bar_file = output_dir / "internal_country_logins_barchart.html"
            fig_bar_internal.write_html(bar_file)
            try:
                fig_bar_internal.write_image(output_dir / "internal_country_logins_barchart.png", width=CHART_WIDTH, height=CHART_HEIGHT)
            except Exception:
                pass
            _open(bar_file)

            internal_country_logins.drop(columns=["iso_alpha"], inplace=True)
            internal_country_logins.to_csv(output_dir / "internal_country_logins.csv", index=False)
            internal_country_logins.to_html(
                output_dir / "internal_country_logins_table.html", index=False, border=0
            )
            _open(output_dir / "internal_country_logins_table.html")

    # --- Part 3: External Logins by Country ---
    if "Country" in df.columns and "Experience" in df.columns:
        external_df = df[
            df["Experience"].str.contains("Reseller Portal", na=False, case=False)
        ]
        if not external_df.empty:
            external_country_logins = external_df.groupby("Country").agg(
                Successful_Logins=("Successful Logins", "sum"),
                Failed_Logins=("Failed Logins", "sum"),
            ).reset_index()
            external_country_logins["Total Logins"] = (
                external_country_logins["Successful_Logins"]
                + external_country_logins["Failed_Logins"]
            )
            external_country_logins["iso_alpha"] = coco.convert(
                names=external_country_logins["Country"],
                src="name_short",
                to="ISO3",
                not_found=None,
            )
            external_country_logins = external_country_logins.sort_values(
                by="Total Logins", ascending=False
            )

            fig_map_external = px.choropleth(
                external_country_logins,
                locations="iso_alpha",
                color="Total Logins",
                hover_name="Country",
                hover_data=["Successful_Logins", "Failed_Logins"],
                color_continuous_scale=px.colors.sequential.Viridis,
                title="World Map of External (Community) Logins",
            )
            map_file = output_dir / "external_country_logins_map.html"
            fig_map_external.write_html(map_file)
            _open(map_file)

            external_melted = external_country_logins.melt(
                id_vars="Country",
                value_vars=["Successful_Logins", "Failed_Logins"],
                var_name="Login_Status",
                value_name="Number_of_Logins",
            )
            fig_bar_external = px.bar(
                external_melted,
                x="Country",
                y="Number_of_Logins",
                color="Login_Status",
                barmode="group",
                title="External Logins by Country (Successful vs. Failed)",
                text_auto=True,
                color_discrete_map={"Successful_Logins": "green", "Failed_Logins": "red"},
            )
            fig_bar_external.update_layout(xaxis={"categoryorder": "total descending"})
            _layout_more_categories(fig_bar_external)

            bar_file = output_dir / "external_country_logins_barchart.html"
            fig_bar_external.write_html(bar_file)
            try:
                fig_bar_external.write_image(output_dir / "external_country_logins_barchart.png", width=CHART_WIDTH, height=CHART_HEIGHT)
            except Exception:
                pass
            _open(bar_file)

            external_country_logins.drop(columns=["iso_alpha"], inplace=True)
            external_country_logins.to_csv(output_dir / "external_country_logins.csv", index=False)
            external_country_logins.to_html(
                output_dir / "external_country_logins_table.html", index=False, border=0
            )
            _open(output_dir / "external_country_logins_table.html")

    # --- Part 4: Failure Analysis ---
    failures_df = df[df["Status"] != "Success"]
    if not failures_df.empty:
        failure_counts = (
            failures_df["Status"].value_counts().reset_index()
        )
        failure_counts.columns = ["Failure Reason", "Count"]
        failure_counts = failure_counts.sort_values(by="Count", ascending=False)

        fig_bar_failures = px.bar(
            failure_counts,
            x="Failure Reason",
            y="Count",
            title="Breakdown of Login Failure Reasons",
            text_auto=True,
            color="Count",
            color_continuous_scale=px.colors.sequential.Reds,
        )
        fig_bar_failures.update_layout(xaxis={"categoryorder": "total descending"})
        _layout_more_categories(fig_bar_failures)

        bar_file = output_dir / "failure_analysis_chart.html"
        fig_bar_failures.write_html(bar_file)
        try:
            fig_bar_failures.write_image(output_dir / "failure_analysis_chart.png", width=CHART_WIDTH, height=CHART_HEIGHT)
        except Exception:
            pass
        _open(bar_file)
        failure_counts.to_csv(output_dir / "failure_analysis.csv", index=False)
        failure_counts.to_html(output_dir / "failure_analysis_table.html", index=False, border=0)
        _open(output_dir / "failure_analysis_table.html")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Analyze Login History CSV and generate charts/tables."
    )
    parser.add_argument(
        "--directory",
        "-d",
        type=str,
        default=None,
        help="Directory to search for *LoginHistory*.csv (default: current directory)",
    )
    parser.add_argument(
        "--delay",
        type=int,
        default=0,
        metavar="SECONDS",
        help="Wait this many seconds before looking for the CSV (e.g. for download to finish)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open HTML outputs in the browser (for automated runs)",
    )
    parser.add_argument(
        "--output-dir",
        "-o",
        type=str,
        default=None,
        help="Write all outputs into this directory (default: Login_Analysis_Output next to the CSV)",
    )
    args = parser.parse_args()

    if args.delay > 0:
        print(f"Waiting {args.delay} seconds for login history download to complete...")
        import time
        time.sleep(args.delay)

    directory = Path(args.directory).resolve() if args.directory else Path.cwd()
    if args.directory and not directory.is_dir():
        print(f"Error: Directory not found: {directory}")
        sys.exit(1)

    pattern = str(directory / "*LoginHistory*.csv")
    files_found = glob.glob(pattern)

    if not files_found:
        print(f"No CSV file matching *LoginHistory*.csv found in {directory}")
        sys.exit(1)

    # Use the most recently modified if multiple
    file_path = max(files_found, key=os.path.getmtime)
    print(f"Using file: {file_path}")

    try:
        df = pd.read_csv(file_path, encoding="utf-8", on_bad_lines="warn", low_memory=False)
    except UnicodeDecodeError:
        df = pd.read_csv(file_path, encoding="latin1", on_bad_lines="warn", low_memory=False)

    df.columns = df.columns.str.strip()
    if args.output_dir:
        output_dir = Path(args.output_dir).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
    else:
        output_dir = Path(file_path).parent / "Login_Analysis_Output"
    success = analyze_logins(df, output_dir=output_dir, open_browser=not args.no_browser)
    if success:
        print(f"\nDone. Output saved to: {output_dir}")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
