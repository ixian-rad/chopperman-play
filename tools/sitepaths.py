"""Site layout shared by the generators. The root URL is the splash page (index.html, tools/build_splash.py); the main page lives at home/.
Generators write fragments with links relative to the site root and call rebase() to fix them up for the page they land on."""
import os, re
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPLASH = f'{SITE}/index.html'
HOME = f'{SITE}/home/index.html'
HOME_ROOT = '../'  # home/ is one folder down from the site root

_ATTR = re.compile(r'\b(href|src|poster|content)="([^"]*)"')
_SRCSET = re.compile(r'\bsrcset="([^"]*)"')


def _fix(u, root):
    if not u or not root or u.startswith(('#', '/', '../', 'http:', 'https:', 'mailto:', 'data:', 'javascript:')) or ':' in u.split('/')[0]:
        return u
    return root + u


def rebase(frag, root):
    """Prefix site-root-relative href/src/poster/srcset (and og:image content) URLs in an HTML fragment with root (e.g. '../')."""
    if not root:
        return frag
    def attr(m):
        k, v = m.group(1), m.group(2)
        if k == 'content' and not re.match(r'[\w./-]+\.(png|jpe?g|webp|svg)$', v):  # only image paths in <meta content>
            return m.group(0)
        return f'{k}="{_fix(v, root)}"'
    frag = _ATTR.sub(attr, frag)
    return _SRCSET.sub(lambda m: 'srcset="' + ', '.join(' '.join([_fix(p.strip().split(' ')[0], root)] + p.strip().split(' ')[1:]) for p in m.group(1).split(',')) + '"', frag)
