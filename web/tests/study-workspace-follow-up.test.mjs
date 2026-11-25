import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkPdfLimit, selectListedPdfs} from '../lib/bulk-resources.ts';
import {readerMaterials} from '../lib/resource-links.ts';
import {focusTaskLabel, focusTasksForContext, sortStudyTasks, sortWeeklyActivities} from '../lib/task-view.ts';

const indexed = id => ({id, name:`${id}.pdf`, path:'Backups', links:[], suggestion:null});
test('select visible uses indexed PDFs without MIME fields and deduplicates across both views', () => {
  const selected = [{id:'already', name:'already.pdf', mimeType:'application/pdf'}];
  const listed = [
    {id:'folder', name:'Folder', mimeType:'application/vnd.google-apps.folder'},
    indexed('already'), indexed('new'), indexed('new'),
    {id:'browse', name:'browse.pdf', mimeType:'application/pdf'},
  ];
  const result = selectListedPdfs(selected, listed);
  assert.deepEqual(result, [selected[0], listed[2], listed[4]]);
  assert.equal(selectListedPdfs(result, listed), result);
  assert.equal(selectListedPdfs(result, Array.from({length:40}, (_,i)=>indexed(`extra-${i}`))).length, bulkPdfLimit);
  assert.equal(selected.length,1);
});

const resource = (id, kind, overrides={}) => ({
  id, title:id, kind, source:'drive', drive_file_id:id, course_id:'c', week_number:null, ...overrides,
});
test('reader keeps weekly files and explicitly linked shared files, excluding unrelated course resources', () => {
  const book = resource('book','textbook');
  const linkedFromItem = resource('linked A','annotated');
  const linkedFromResource = resource('linked B','handwritten',{item_id:'item'});
  const sameWeek = resource('current week','slides',{week_number:2});
  const noFile = resource('missing file','other',{week_number:2,drive_file_id:null});
  const otherWeek = resource('old week','slides',{week_number:1});
  const otherCourse = resource('other course','slides',{week_number:2,course_id:'elsewhere'});
  const exam = resource('exam','exam_paper',{week_number:2});
  const unrelated = resource('unrelated','textbook');
  const items = [{id:'item',course_id:'c',week_number:2,resource_id:linkedFromItem.id}];
  const resources = [sameWeek, noFile, otherWeek, linkedFromItem, linkedFromResource, unrelated, otherCourse, exam, book];
  assert.deepEqual(readerMaterials(book,2,items,resources), [linkedFromItem,linkedFromResource,sameWeek]);
  assert.deepEqual(readerMaterials(book,undefined,items,resources), []);
  assert.deepEqual(readerMaterials(undefined,2,items,resources), []);
});

test('reader only offers the current exam paper and its paired solutions', () => {
  const paper = resource('paper','exam_paper');
  const solution = resource('solution','exam_solution',{exam_paper_id:paper.id});
  const legacySolution = resource('legacy','exam_solution',{exam_paper_id:paper.id});
  const unpaired = resource('unpaired','exam_solution');
  const otherCourse = resource('invalid','exam_solution',{exam_paper_id:paper.id,course_id:'other'});
  const resources = [paper, solution, legacySolution, unpaired, otherCourse, resource('other paper','exam_paper')];
  assert.deepEqual(readerMaterials(paper,undefined,[],resources), [solution,legacySolution]);
  assert.deepEqual(readerMaterials(solution,undefined,[],resources), [paper]);
  assert.deepEqual(readerMaterials(unpaired,undefined,[],resources), []);
});

const task = (id, kind, overrides={}) => ({
  id, kind, course_id:'c', title:id, week_number:1, done:false, is_task:true,
  due_date:null, planned_date:null, ...overrides,
});
test('Overview follows learning order, and Study tasks can sort by teaching week or schedule', () => {
  const lecture = task('Lecture slides','lecture',{done:true});
  const reading = task('Book reading','reading');
  const questions = task('Book questions','questions');
  const later = task('Week 10 assignment','assignment',{week_number:10,due_date:'2026-12-02'});
  const nearer = task('Week 2 assignment','assignment',{week_number:2,planned_date:'2026-12-05'});
  assert.deepEqual(sortWeeklyActivities([questions,later,reading,lecture]), [lecture,reading,questions,later]);
  assert.deepEqual(sortStudyTasks([later,nearer,reading,lecture]), [reading,lecture,nearer,later]);
  assert.deepEqual(sortStudyTasks([later,nearer,reading,lecture],'due'), [later,nearer,reading,lecture]);
});

test('Focus labels repeated assignments by week and retains an explicitly opened activity', () => {
  const week10 = task('week10','assignment',{title:'Assignments',week_number:10});
  const week2 = task('week2','assignment',{title:'Assignments',week_number:2});
  const week1 = task('week1','lecture',{is_task:false});
  const revision = task('Practice','revision',{week_number:null});
  const other = task('other','assignment',{course_id:'other'});
  const list = [week10,revision,week1,other,week2];
  assert.deepEqual(focusTasksForContext(list,'c').map(focusTaskLabel), [
    'Week 2 · Assignments','Week 10 · Assignments','Exam prep · Practice',
  ]);
  assert.deepEqual(focusTasksForContext(list,'c',week1.id), [week1,week2,week10,revision]);
  assert.deepEqual(focusTasksForContext(list,'c',other.id), [week2,week10,revision]);
});
