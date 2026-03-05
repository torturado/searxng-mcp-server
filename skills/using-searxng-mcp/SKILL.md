---
name: using-searxng-mcp
description: Use when an LLM must browse the web through this repository's MCP server and decide between search and fetch while handling noisy results, truncation, and request failures.
---

# Using SearXNG MCP

## Overview

This skill defines how to use this MCP server effectively for web research.
Core rule: **search first, fetch selectively**.

## When to Use

Use this skill when:

- you need internet information through this MCP server
- you must choose between `search` and `fetch`
- results are noisy and need refinement
- fetched page content is truncated or incomplete

Do not use this skill when the answer is already in local project files.

## Core Pattern

1. Call `search` with a focused query.
2. Inspect `structuredContent.results` and prefer high-signal sources.
3. Call `fetch` only for the top 1-3 relevant URLs.
4. If quality is poor, refine query and search again.

## Quick Reference

| Task                       | Tool     | Guidance                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------ |
| Discover candidate sources | `search` | Always first step.                                                             |
| Open one known URL         | `fetch`  | Use absolute URL only.                                                         |
| Improve noisy results      | `search` | Add `language`, `categories`, `timeRange`, lower `limit`.                      |
| Get more results           | `search` | Increase `limit` (max 10) or use `pageno`.                                     |
| Handle empty results       | `search` | Rewrite query with clearer entities and constraints.                           |
| Handle long page output    | `fetch`  | Check `truncated`; fetch additional sources instead of over-trusting one page. |

## Implementation

- `search` inputs: `query` (required), optional `pageno`, `language`, `categories`, `safesearch`, `timeRange`, `limit`.
- `fetch` input: `url` (required absolute URL).
- Prefer `structuredContent` for programmatic decisions and `content` for readable summaries.
- Respect defaults:
    - search timeout: 15s
    - fetch timeout: 10s
    - fetch max output: ~500KB

## Failure Handling

- If a tool returns `isError: true`, do not retry blindly.
- For search failures:
    - simplify query
    - reduce constraints
    - retry once
- For fetch failures:
    - try an alternate result URL from the same search
    - if repeated failures, return partial findings with source links

## Common Mistakes

- Calling `fetch` before `search` without a known target URL.
- Using broad queries and then trusting the first result.
- Ignoring `truncated` and treating partial page text as complete.
- Fetching too many URLs instead of refining the search query.
- Treating empty snippets as unusable without checking title/domain relevance.
