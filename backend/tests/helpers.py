"""Explicit registered-semester setup for API regression tests."""


def create_course(client, payload):
    payload = dict(payload)
    if not payload.get('semester_id'):
        name = payload.pop('semester', 'Autumn 2026')
        existing = next((s for s in client.get('/api/snapshot').json()['semesters'] if s['name'] == name), None)
        if existing is None:
            response = client.post('/api/semesters', json={'name': name})
            assert response.status_code == 201, response.text
            existing = response.json()
        payload['semester_id'] = existing['id']
    return client.post('/api/courses', json=payload)
