import test from "node:test";
import assert from "node:assert/strict";

import { selectToolCallSuccessPct } from "../lib/tool-call-success.mjs";

test("falls back to 30 day tool-call success when 7 day window has no tool calls", () => {
  const stats7 = {
    adoption_kpi: {
      tool_call_requests: 0,
      tool_call_success_rate_pct: 0,
    },
  };
  const stats30 = {
    adoption_kpi: {
      tool_call_requests: 3,
      tool_call_success_rate_pct: 100,
    },
  };

  assert.equal(selectToolCallSuccessPct(stats7, stats30), 100);
});

test("prefers 7 day tool-call success when the weekly window has tool calls", () => {
  const stats7 = {
    adoption_kpi: {
      tool_call_requests: 2,
      tool_call_success_rate_pct: 50,
    },
  };
  const stats30 = {
    adoption_kpi: {
      tool_call_requests: 8,
      tool_call_success_rate_pct: 87.5,
    },
  };

  assert.equal(selectToolCallSuccessPct(stats7, stats30), 50);
});

test("returns zero when there are no recent tool calls in either window", () => {
  assert.equal(selectToolCallSuccessPct({}, {}), 0);
});
