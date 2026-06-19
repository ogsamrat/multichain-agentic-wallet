#!/usr/bin/env ruby
# frozen_string_literal: true

# Prism Index agent client (Ruby).
#
# Discovers verified, agent-payable services from the Prism Index using only the
# standard library.
#
# Usage:
#   ruby agent.rb "datasets"
#   PRISM_INDEX_URL=http://localhost:8787 ruby agent.rb

require 'json'
require 'net/http'
require 'uri'

INDEX_URL = ENV.fetch('PRISM_INDEX_URL', 'https://prism-index.vercel.app')

def search(query: nil, asset: 'USDC')
  params = {}
  params['q'] = query if query
  params['asset'] = asset if asset
  uri = URI("#{INDEX_URL}/v1/search")
  uri.query = URI.encode_www_form(params)
  response = Net::HTTP.get_response(uri)
  JSON.parse(response.body)
end

data = search(query: ARGV[0])
results = data['results'] || []

puts "Prism Index @ #{INDEX_URL}"
puts "#{data['count'] || results.length} verified service(s)\n\n"

results.each do |r|
  score = (r['reliabilityScore'] || 0).round
  puts "- #{r['name'] || r['slug']}  [#{r['type']}]  reliability #{score}/100"
  puts "  #{r['description']}" if r['description']
  (r['paymentOptions'] || []).each do |o|
    puts "  pay: #{o['network']} #{o['assetSymbol']} $#{o['priceUsd']} -> #{o['payTo']}"
  end
  puts
end
