// Prism Index agent client (Go).
//
// Discovers verified, agent-payable services from the Prism Index using only the
// standard library.
//
// Usage:
//
//	go run . "rpc"
//	PRISM_INDEX_URL=http://localhost:8787 go run .
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"
)

type paymentOption struct {
	Network     string  `json:"network"`
	AssetSymbol string  `json:"assetSymbol"`
	PriceUsd    float64 `json:"priceUsd"`
	PayTo       string  `json:"payTo"`
}

type listing struct {
	Slug             string          `json:"slug"`
	Type             string          `json:"type"`
	Name             string          `json:"name"`
	Description      string          `json:"description"`
	ReliabilityScore float64         `json:"reliabilityScore"`
	PaymentOptions   []paymentOption `json:"paymentOptions"`
}

type searchResponse struct {
	Count   int       `json:"count"`
	Results []listing `json:"results"`
}

func indexURL() string {
	if v := os.Getenv("PRISM_INDEX_URL"); v != "" {
		return v
	}
	return "https://prism-index.vercel.app"
}

func main() {
	query := ""
	if len(os.Args) > 1 {
		query = os.Args[1]
	}

	params := url.Values{}
	if query != "" {
		params.Set("q", query)
	}
	params.Set("asset", "USDC")
	endpoint := fmt.Sprintf("%s/v1/search?%s", indexURL(), params.Encode())

	client := &http.Client{Timeout: 20 * time.Second}
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "build request failed:", err)
		os.Exit(1)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintln(os.Stderr, "request failed:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	var out searchResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		fmt.Fprintln(os.Stderr, "decode failed:", err)
		os.Exit(1)
	}

	fmt.Printf("Prism Index @ %s\n%d verified service(s)\n\n", indexURL(), out.Count)
	for _, r := range out.Results {
		name := r.Name
		if name == "" {
			name = r.Slug
		}
		fmt.Printf("- %s  [%s]  reliability %.0f/100\n", name, r.Type, r.ReliabilityScore)
		if r.Description != "" {
			fmt.Printf("  %s\n", r.Description)
		}
		for _, o := range r.PaymentOptions {
			fmt.Printf("  pay: %s %s $%.3f -> %s\n", o.Network, o.AssetSymbol, o.PriceUsd, o.PayTo)
		}
		fmt.Println()
	}
}
