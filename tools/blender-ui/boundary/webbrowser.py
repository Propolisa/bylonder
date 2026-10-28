def open(url, new=0, autoraise=True):
    __pragma__('js', '{}', 'globalThis.open?.(url, "_blank");')
    return True
