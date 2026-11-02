import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { HomeRedirect, FullPageSpinner, RequireRole } from '@/auth/RequireRole'
import { AppShell } from '@/components/AppShell'
import { ExamLockGate } from '@/components/exam/ExamLockGate'
import { StudyFlowProvider } from '@/components/study/StudyFlowProvider'
import Landing from '@/pages/Landing'
import Login from '@/pages/auth/Login'
import LegacyLibraryRedirect from '@/pages/library/LegacyLibraryRedirect'
// Every route's `lazy` retries a failed download and reloads once on a stale chunk (see lib/lazyWithRetry).
import { lazyWithRetry as lazy } from '@/lib/lazyWithRetry'

// Route-level code splitting keeps react-pdf (large) out of the initial bundle.
const TeacherDashboard = lazy(() => import('@/pages/teacher/TeacherDashboard'))
const LessonPlans = lazy(() => import('@/pages/teacher/LessonPlans'))
const QuestionGenerator = lazy(() => import('@/pages/teacher/QuestionGenerator'))
const QuestionPaperEditor = lazy(() => import('@/pages/teacher/QuestionPaperEditor'))
const Wellbeing = lazy(() => import('@/pages/teacher/Wellbeing'))
const Wellness = lazy(() => import('@/pages/student/Wellness'))
const MyClasses = lazy(() => import('@/pages/teacher/MyClasses'))
const TeacherAttendance = lazy(() => import('@/pages/teacher/TeacherAttendance'))
const TeacherTimetable = lazy(() => import('@/pages/teacher/TeacherTimetable'))
const TeacherHomework = lazy(() => import('@/pages/teacher/TeacherHomework'))
const Evaluation = lazy(() => import('@/pages/teacher/Evaluation'))
const StudentDashboard = lazy(() => import('@/pages/student/StudentDashboard'))
const AiClassroomHome = lazy(() => import('@/pages/student/AiClassroomHome'))
const AvatarSubjectClassroom = lazy(() => import('@/pages/student/AvatarSubjectClassroom'))
const NlpChapterReader = lazy(() => import('@/pages/student/NlpChapterReader'))
const MyAttendance = lazy(() => import('@/pages/student/MyAttendance'))
const StudentTimetable = lazy(() => import('@/pages/student/StudentTimetable'))
const StudentHomework = lazy(() => import('@/pages/student/StudentHomework'))
const StudentEvaluations = lazy(() => import('@/pages/student/StudentEvaluations'))
const StudentAssessments = lazy(() => import('@/pages/student/StudentAssessments'))
const TestRunner = lazy(() => import('@/pages/student/TestRunner'))
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'))
const TeacherLibrary = lazy(() => import('@/pages/teacher/TeacherLibrary'))
const StudentLibrary = lazy(() => import('@/pages/student/StudentLibrary'))
const BookReader = lazy(() => import('@/pages/library/BookReader'))
const DikshaReader = lazy(() => import('@/pages/library/DikshaReader'))
const CounsellorHome = lazy(() => import('@/pages/admissions/CounsellorHome'))
const ReviewerHome = lazy(() => import('@/pages/admissions/ReviewerHome'))
const ParentPortal = lazy(() => import('@/pages/parent/ParentPortal'))
const TeacherVirtualLabs = lazy(() => import('@/pages/teacher/TeacherVirtualLabs'))
const StudentVirtualLabs = lazy(() => import('@/pages/student/StudentVirtualLabs'))
const VirtualLabWorkspace = lazy(() => import('@/pages/student/VirtualLabWorkspace'))
const TeacherAdmissions = lazy(() => import('@/pages/teacher/TeacherAdmissions'))
const AdmissionTestEditor = lazy(() => import('@/pages/teacher/AdmissionTestEditor'))
const AdmissionReport = lazy(() => import('@/pages/admissions/AdmissionReport'))
const AdmissionForms = lazy(() => import('@/pages/teacher/AdmissionForms'))
// The standalone admission application: its own layout, login and API client (no AppShell, no LMS session).
const ApplyApp = lazy(() => import('@/pages/apply/ApplyApp'))
const TeacherProctoring = lazy(() => import('@/pages/teacher/TeacherProctoring'))
const ProctoringExam = lazy(() => import('@/pages/teacher/ProctoringExam'))
// The exam view renders without AppShell (no portal chrome or teacher data) and carries the proctoring code.
const ExamView = lazy(() => import('@/pages/exam/ExamView'))

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <ExamLockGate>
      {/* Students only: the floating Focus Timer and the 25 / 5 study-break reminders (inert for other roles). */}
      <StudyFlowProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />

        <Route element={<RequireRole roles={['teacher']} />}>
          <Route element={<AppShell />}>
            <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
            <Route path="/teacher/classes" element={<MyClasses />} />
            <Route path="/teacher/attendance" element={<TeacherAttendance />} />
            <Route path="/teacher/timetable" element={<TeacherTimetable />} />
            <Route path="/teacher/homework" element={<TeacherHomework />} />
            <Route path="/teacher/evaluation" element={<Evaluation key="exam" kind="OFFLINE_EXAM" />} />
            <Route path="/teacher/evaluation-analytics" element={<Evaluation key="exam" kind="OFFLINE_EXAM" />} />
            <Route path="/teacher/tests" element={<Evaluation key="test" kind="ONLINE_TEST" />} />
            <Route path="/teacher/assignments" element={<Evaluation key="assignment" kind="ASSIGNMENT" />} />
            <Route path="/teacher/tests/create" element={<Navigate to="/teacher/tests?new=1" replace />} />
            <Route path="/teacher/assignments/create" element={<Navigate to="/teacher/assignments?new=1" replace />} />
            <Route path="/teacher/library" element={<TeacherLibrary />} />
            <Route path="/teacher/virtual-labs" element={<TeacherVirtualLabs />} />
            <Route path="/teacher/admissions" element={<TeacherAdmissions />} />
            <Route path="/teacher/admissions/tests/:testId" element={<AdmissionTestEditor />} />
            <Route path="/teacher/admissions/reports/:sessionId" element={<AdmissionReport />} />
            <Route path="/teacher/admission-forms" element={<AdmissionForms />} />
            <Route path="/teacher/lesson-plans" element={<LessonPlans />} />
            <Route path="/teacher/question-generator" element={<QuestionGenerator />} />
            <Route path="/teacher/question-generator/papers/:paperId" element={<QuestionPaperEditor />} />
            <Route path="/teacher/question-bank" element={<QuestionGenerator />} />
            <Route path="/teacher/wellbeing" element={<Wellbeing />} />
            <Route path="/teacher/proctoring" element={<TeacherProctoring />} />
            <Route path="/teacher/proctoring/exam" element={<ProctoringExam />} />
            <Route path="/teacher/mindset" element={<Navigate to="/teacher/wellbeing" replace />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['student']} />}>
          <Route element={<AppShell />}>
            <Route path="/student/dashboard" element={<StudentDashboard />} />
            <Route path="/student/classroom" element={<AiClassroomHome />} />
            <Route path="/student/classroom/textbook" element={<AvatarSubjectClassroom />} />
            <Route path="/student/classroom/nlp/:classLabel/:subject/:chapter" element={<NlpChapterReader />} />
            <Route path="/student/attendance" element={<MyAttendance />} />
            <Route path="/student/timetable" element={<StudentTimetable />} />
            <Route path="/student/homework" element={<StudentHomework />} />
            <Route path="/student/library" element={<StudentLibrary />} />
            <Route path="/student/virtual-labs" element={<StudentVirtualLabs />} />
            <Route path="/student/virtual-labs/:id" element={<VirtualLabWorkspace />} />
            <Route path="/student/evaluations" element={<StudentEvaluations />} />
            <Route path="/student/wellness" element={<Wellness />} />
            <Route path="/student/tests" element={<StudentAssessments kind="ONLINE_TEST" />} />
            <Route path="/student/tests/:id" element={<StudentAssessments kind="ONLINE_TEST" />} />
            <Route path="/student/tests/:id/take" element={<TestRunner />} />
            <Route path="/student/assignments" element={<StudentAssessments kind="ASSIGNMENT" />} />
            <Route path="/student/assignments/:id" element={<StudentAssessments kind="ASSIGNMENT" />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['teacher', 'student', 'orgadmin', 'superadmin']} />}>
          <Route element={<AppShell />}>
            <Route path="/library/read/:bookId" element={<BookReader />} />
            <Route path="/library/explore/:sourceId" element={<DikshaReader />} />
            <Route path="/library/diksha/:sourceId" element={<LegacyLibraryRedirect />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['counsellor']} />}>
          <Route element={<AppShell />}>
            <Route path="/admissions/counsellor" element={<CounsellorHome />} />
            <Route path="/admissions/applications" element={<AdmissionForms />} />
          </Route>
        </Route>
        <Route element={<RequireRole roles={['reviewer']} />}>
          <Route element={<AppShell />}>
            <Route path="/admissions/reviewer" element={<ReviewerHome />} />
          </Route>
        </Route>
        <Route element={<RequireRole roles={['parent']} />}>
          <Route element={<AppShell />}>
            <Route path="/parent" element={<ParentPortal />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['orgadmin', 'superadmin']} />}>
          <Route element={<AppShell />}>
            <Route path="/admin-dashboard" element={<AdminDashboard />} />
            <Route path="/admin/admission-reports/:sessionId" element={<AdmissionReport />} />
          </Route>
        </Route>

        {/* FRD v3 portal routes map onto the shared admin console */}
        <Route path="/superadmin/dashboard" element={<Navigate to="/admin-dashboard" replace />} />
        <Route path="/admin/dashboard" element={<Navigate to="/admin-dashboard" replace />} />
        <Route path="/admin/evaluation-scores" element={<Navigate to="/admin-dashboard?tab=evaluation" replace />} />
        <Route path="/admin/assessment-scores" element={<Navigate to="/admin-dashboard?tab=evaluation" replace />} />
        {/* Own Suspense boundary: navigating here unmounts the portal tree at once (Launch then clears the user). */}
        <Route path="/admission/exam/:sessionId" element={<Suspense fallback={<FullPageSpinner />}><ExamView /></Suspense>} />
        <Route path="/apply/:slug/*" element={<Suspense fallback={<FullPageSpinner />}><ApplyApp /></Suspense>} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
      </StudyFlowProvider>
      </ExamLockGate>
    </Suspense>
  )
}
