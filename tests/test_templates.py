"""The login / error pages are still Bottle templates; make sure they render."""

import pathlib

import pytest
from bottle import template

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'theonionbox'


def render(name, **params):
    return template(name, template_lookup=[str(ROOT)], **params)


def test_box_css_renders_for_login_and_error():
    css = render('css/box.css', sections=['!header', 'header', '!content', 'login', 'license'])
    assert '--primary' in css and '.auth-card' in css and '.sk-three-bounce' in css


def test_error_section_escapes_message():
    html = render('sections/error/error.html', error_msg='<script>alert(1)</script>', box_stamp='x')
    assert '<script>' not in html


def test_python_sources_have_no_syntax_warnings():
    import warnings
    for f in ROOT.rglob('*.py'):
        if 'libs' in f.parts:
            continue
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            compile(f.read_text(encoding='utf-8'), str(f), 'exec')
