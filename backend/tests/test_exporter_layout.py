from app.services.exporter import layout_needs_rerender


def test_rerender_when_manual_subjects_present():
    assert layout_needs_rerender(selected=None, disabled_backdrop=[], manual_subjects=[{"id": "m1"}], zoom_active=False)


def test_no_rerender_when_nothing_curated():
    assert not layout_needs_rerender(selected=None, disabled_backdrop=[], manual_subjects=[], zoom_active=False)


def test_rerender_when_curated_or_zoom():
    assert layout_needs_rerender(selected=[3], disabled_backdrop=[], manual_subjects=[], zoom_active=False)
    assert layout_needs_rerender(selected=None, disabled_backdrop=["top"], manual_subjects=[], zoom_active=False)
    assert layout_needs_rerender(selected=None, disabled_backdrop=[], manual_subjects=[], zoom_active=True)
