# Kiwi modules: personal

derlocke's own modules (smartfritz and companion), for [kiwi-server](https://github.com/derlocke-ng/kiwi-server) beyond the built-in ones:
a folder per module in `modules/`, each with its `module.yaml` and templates, in the format of
[kiwi-modules](https://github.com/derlocke-ng/kiwi-modules).

## Use them

```bash
kiwi-server sources ~/kiwi/fleet.yaml add https://github.com/derlocke-ng/kiwi-modules-personal
```

That pins the repository to the commit it is at now; nothing of it changes until
`kiwi-server sources ~/kiwi/fleet.yaml update kiwi-modules-personal`. Then add a module to a machine like a
built-in one. Its templates and scripts run as root on that machine: add only sources you trust.

## Write one

`kiwi-server sources new FOLDER` makes a new source with an example module. Rename the folder and the `name:` in its `module.yaml`. The keys a module
has: [the module reference](https://github.com/derlocke-ng/kiwi-server/blob/main/docs/modules.md).
A name that a built-in module has is refused.

Check that every module renders, as on a machine:

```bash
git clone https://github.com/derlocke-ng/kiwi-modules ../kiwi-modules
python3 tools/check-modules.py
```

A module with required settings gets made-up values for the check in `modules/<name>/check.yaml`:

```yaml
settings:
  fritz_url: https://192.168.2.1
```

The same check runs on every push and pull request (`.github/workflows/check.yml`).

## Documentation

| Page | What it covers |
|---|---|
| [Companion](docs/companion.md) | The `companion` module, a Discord companion for one person: what leaves the house, the setup at Discord, its commands, voice, memory. Its program is in [companion/](companion/README.md). |

## Versions

Every module has its `version:` in its module.yaml, and the source has one in `VERSION`. A
change to a module bumps both (`tools/check-versions.py` checks it in a pull request); merged
to main, `VERSION` becomes a tag (`v0.2.0`), and that is what `kiwi-server sources … update`
pins. Without tags a fleet follows the default branch.
