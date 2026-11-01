# Blender's bpy.msgbus (C): Bylonder's side. Subscriptions are kept by owner; nothing publishes RNA changes to them yet.
_subscriptions = []


def subscribe_rna(key=None, owner=None, args=(), notify=None, options=None):
    _subscriptions.append((owner, key, args, notify))


def clear_by_owner(owner):
    _subscriptions[:] = [s for s in _subscriptions if s[0] is not owner]


def publish_rna(key=None):
    pass
