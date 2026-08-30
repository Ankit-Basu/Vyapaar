"""Mandi Grow: the merchant's side of the counter.

The rest of this service bounds what a buying *agent* may spend. This package
bounds what the *merchant* may give away to win that spend. A discount is a money
action in exactly the same sense a purchase is, so it gets the same treatment:
an ordered gauntlet of deterministic checks, a budget ledger with reserve and
settle, a human gate when it goes deep, and a row on the same audit chain.
"""
