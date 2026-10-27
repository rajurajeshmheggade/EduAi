import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { HomeRedirect, FullPageSpinner, RequireRole } from '@/auth/RequireRole'
import { AppShell } from '@/components/AppShell'
import Landing from '@/pages/Landing'
import Login from '@/pages/auth/Login'

// Route-level code splitting keeps react-pdf (large) out of the initial bundle.
const TeacherDashboard = lazy(() => import('@/pages/teacher/TeacherDashboard'))
const TextbookHowToTeach = lazy(() => import('@/pages/teacher/TextbookHowToTeach'))
const LessonPlans = lazy(() => import('@/pages/teacher/LessonPlans'))
const MyClasses = lazy(() => import('@/pages/teacher/MyClasses'))
const TeacherAttendance = lazy(() => import('@/pages/teacher/TeacherAttendance'))
const TeacherTimetable = lazy(() => import('@/pages/teacher/TeacherTimetable'))
const TeacherHomework = lazy(() => import('@/pages/teacher/TeacherHomework'))
const Evaluation = lazy(() => import('@/pages/teacher/Evaluation'))
const StudentDashboard = lazy(() => import('@/pages/student/StudentDashboard'))
const AvatarSubjectClassroom = lazy(() => import('@/pages/student/AvatarSubjectClassroom'))
const MyAttendance = lazy(() => import('@/pages/student/MyAttendance'))
const StudentTimetable = lazy(() => import('@/pages/student/StudentTimetable'))
const StudentHomework = lazy(() => import('@/pages/student/StudentHomework'))
const StudentEvaluations = lazy(() => import('@/pages/student/StudentEvaluations'))
const StudentAssessments = lazy(() => import('@/pages/student/StudentAssessments'))
const TestRunner = lazy(() => import('@/pages/student/TestRunner'))
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'))

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
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
            <Route path="/teacher/textbooks" element={<TextbookHowToTeach />} />
            <Route path="/teacher/lesson-plans" element={<LessonPlans />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['student']} />}>
          <Route element={<AppShell />}>
            <Route path="/student/dashboard" element={<StudentDashboard />} />
            <Route path="/student/classroom" element={<AvatarSubjectClassroom />} />
            <Route path="/student/attendance" element={<MyAttendance />} />
            <Route path="/student/timetable" element={<StudentTimetable />} />
            <Route path="/student/homework" element={<StudentHomework />} />
            <Route path="/student/evaluations" element={<StudentEvaluations />} />
            <Route path="/student/tests" element={<StudentAssessments kind="ONLINE_TEST" />} />
            <Route path="/student/tests/:id" element={<StudentAssessments kind="ONLINE_TEST" />} />
            <Route path="/student/tests/:id/take" element={<TestRunner />} />
            <Route path="/student/assignments" element={<StudentAssessments kind="ASSIGNMENT" />} />
            <Route path="/student/assignments/:id" element={<StudentAssessments kind="ASSIGNMENT" />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['orgadmin', 'superadmin']} />}>
          <Route element={<AppShell />}>
            <Route path="/admin-dashboard" element={<AdminDashboard />} />
          </Route>
        </Route>

        {/* FRD v3 portal routes map onto the shared admin console */}
        <Route path="/superadmin/dashboard" element={<Navigate to="/admin-dashboard" replace />} />
        <Route path="/admin/dashboard" element={<Navigate to="/admin-dashboard" replace />} />
        <Route path="/admin/evaluation-scores" element={<Navigate to="/admin-dashboard?tab=evaluation" replace />} />
        <Route path="/admin/assessment-scores" element={<Navigate to="/admin-dashboard?tab=evaluation" replace />} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </Suspense>
  )
}
