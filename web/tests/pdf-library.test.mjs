import assert from 'node:assert/strict';
import test from 'node:test';
import { filterPdfChoices, pdfLibraryChoices } from '../lib/pdf-library.ts';

test('PDF picker combines saved papers, PDFs from other courses, and indexed or open Drive files', () => {
  const resources = [
    { id: 'current-paper', title: 'Exam 2025.pdf', exam_display_name: 'Winter 2025', kind: 'exam_paper',
      course_id: 'ml', source: 'drive', drive_file_id: 'exam123', week_number: null },
    { id: 'lecture', title: 'Lecture 10.pdf', course_id: 'data', source: 'drive', drive_file_id: 'slides123', week_number: 10 },
    { id: 'external', title: 'Reading', course_id: 'ml', source: 'link', url: 'https://example.test/a.PDF?download=1' },
    { id: 'site', title: 'Course site', course_id: 'data', source: 'link', url: 'https://example.test/course' },
  ];
  const courses = [{ id: 'ml', code: '02456', title: 'Machine learning' }, { id: 'data', code: '02452', title: 'Data science' }];
  const indexed = [{ id: 'slides123', name: 'Duplicate.pdf', path: 'Backups' }, { id: 'notes123', name: 'Notes.pdf', path: 'Goodnotes' }];
  const tabs = [{ key: 'open-lecture', fileId: 'slides123', title: 'Lecture 10.pdf' },
    { key: 'open-other', fileId: 'raw123', title: 'Archive.pdf' }];
  const choices = pdfLibraryChoices(resources, courses, indexed, tabs, 'ml');
  assert.equal(choices.length, 5);
  assert.equal(choices.find(choice => choice.id === 'resource:lecture').openKey, 'open-lecture');
  assert.equal(choices.find(choice => choice.id === 'tab:open-other').openKey, 'open-other');
  assert.deepEqual(filterPdfChoices(choices, 'all', '02452 Week 10').map(choice => choice.id), ['resource:lecture']);
  assert.deepEqual(filterPdfChoices(choices, 'course', '', 'ml').map(choice => choice.id), ['resource:external', 'resource:current-paper']);
  assert.deepEqual(filterPdfChoices(choices, 'drive', 'Goodnotes').map(choice => choice.id), ['drive:notes123']);
});
