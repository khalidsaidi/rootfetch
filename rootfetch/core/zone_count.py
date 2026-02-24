from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from hyperloglog import HyperLogLog


RR_TYPES = {
    "A",
    "AAAA",
    "AFSDB",
    "CAA",
    "CDNSKEY",
    "CDS",
    "CERT",
    "CNAME",
    "CSYNC",
    "DHCID",
    "DLV",
    "DNAME",
    "DNSKEY",
    "DS",
    "EUI48",
    "EUI64",
    "HINFO",
    "HTTPS",
    "IPSECKEY",
    "KEY",
    "KX",
    "LOC",
    "MX",
    "NAPTR",
    "NS",
    "NSEC",
    "NSEC3",
    "NSEC3PARAM",
    "OPENPGPKEY",
    "PTR",
    "RRSIG",
    "RP",
    "SIG",
    "SMIMEA",
    "SOA",
    "SRV",
    "SSHFP",
    "SVCB",
    "TLSA",
    "TXT",
}


def _label_count(name: str) -> int:
    return len([part for part in name.split(".") if part])


def _under_tld(owner: str, tld: str) -> bool:
    return owner == tld or owner.endswith(f".{tld}")


def _is_sld_owner(owner: str, tld: str) -> bool:
    return _under_tld(owner, tld) and _label_count(owner) == _label_count(tld) + 1


def _normalize_name(name: str, origin: str) -> str:
    name = name.strip()
    if name == "@":
        return origin
    if name.endswith("."):
        return name[:-1].lower()
    return f"{name}.{origin}".strip(".").lower()


def _update_origin(raw_origin: str, current_origin: str) -> str:
    raw_origin = raw_origin.strip()
    if raw_origin.endswith("."):
        return raw_origin[:-1].lower()
    if current_origin:
        return f"{raw_origin}.{current_origin}".strip(".").lower()
    return raw_origin.lower()


def _strip_comment(line: str) -> str:
    if ";" not in line:
        return line
    return line.split(";", 1)[0]


@dataclass
class _CardinalityCounter:
    exact: set[str] | None
    approx: HyperLogLog | None

    @classmethod
    def create(cls, mode: str) -> "_CardinalityCounter":
        if mode == "ns_sld_hll":
            return cls(exact=None, approx=HyperLogLog(0.01))
        return cls(exact=set(), approx=None)

    def add(self, value: str) -> None:
        if self.exact is not None:
            self.exact.add(value)
        if self.approx is not None:
            self.approx.add(value)

    def count(self) -> int:
        if self.exact is not None:
            return len(self.exact)
        if self.approx is not None:
            return int(round(len(self.approx)))
        return 0

    @property
    def is_estimate(self) -> bool:
        return self.approx is not None


def parse_zone_metrics(stream: Iterable[str], tld: str, count_mode: str = "ns_sld_exact") -> dict:
    tld = tld.strip(".").lower()
    origin = tld
    last_owner = "@"

    ns_counter = _CardinalityCounter.create(count_mode)
    ds_counter = _CardinalityCounter.create("ns_sld_exact")
    glue_hosts: set[str] = set()
    count_ns_rr = 0

    for raw_line in stream:
        line = _strip_comment(raw_line.rstrip("\n"))
        if not line.strip():
            continue

        stripped = line.lstrip()
        if stripped.upper().startswith("$ORIGIN"):
            tokens = stripped.split()
            if len(tokens) >= 2:
                origin = _update_origin(tokens[1], origin)
            continue
        if stripped.startswith("$"):
            continue

        tokens = stripped.split()
        if not tokens:
            continue

        implicit_owner = line[:1].isspace()
        if implicit_owner:
            owner_token = last_owner
            rr_tokens = tokens
        else:
            owner_token = tokens[0]
            rr_tokens = tokens[1:]

        rr_type = None
        rr_type_index = -1
        for idx, token in enumerate(rr_tokens):
            upper = token.upper()
            if upper in RR_TYPES:
                rr_type = upper
                rr_type_index = idx
                break
        if not rr_type:
            continue

        owner = _normalize_name(owner_token, origin)
        last_owner = owner

        if rr_type == "NS":
            count_ns_rr += 1
            if owner != tld and _is_sld_owner(owner, tld):
                ns_counter.add(owner)
        elif rr_type == "DS":
            if owner != tld and _is_sld_owner(owner, tld):
                ds_counter.add(owner)
        elif rr_type in {"A", "AAAA"}:
            if owner != tld and _under_tld(owner, tld):
                glue_hosts.add(owner)

    return {
        "count_ns_sld": ns_counter.count(),
        "count_ds_sld": ds_counter.count(),
        "count_glue_hosts": len(glue_hosts),
        "count_ns_rr": count_ns_rr,
        "is_estimate": ns_counter.is_estimate,
        "count_mode": count_mode,
    }


def count_delegated_ns_slds(stream: Iterable[str], tld: str, count_mode: str = "ns_sld_exact") -> int:
    metrics = parse_zone_metrics(stream, tld=tld, count_mode=count_mode)
    return int(metrics["count_ns_sld"])
