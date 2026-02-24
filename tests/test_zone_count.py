from __future__ import annotations

from rootfetch.core.zone_count import parse_zone_metrics


def test_zone_metrics_ns_ds_glue_counts() -> None:
    lines = [
        "$ORIGIN app.\n",
        "@ 3600 IN SOA ns1.app. hostmaster.app. 1 7200 3600 1209600 3600\n",
        "example IN NS ns1.example.app.\n",
        "example IN NS ns2.example.app.\n",
        "example IN DS 12345 13 2 ABCD\n",
        "ns1.example IN A 192.0.2.1\n",
        "ns2.example IN AAAA 2001:db8::1\n",
        "a.example IN NS ns.a.example.app.\n",
    ]
    metrics = parse_zone_metrics(lines, tld="app", count_mode="ns_sld_exact")
    assert metrics["count_ns_sld"] == 1
    assert metrics["count_ds_sld"] == 1
    assert metrics["count_glue_hosts"] == 2
    assert metrics["count_ns_rr"] == 3
