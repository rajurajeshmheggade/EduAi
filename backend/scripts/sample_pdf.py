"""Sample multi-chapter physics textbook PDF for demos and tests."""
import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

CHAPTERS = [
    ("Motion", [
        ("1.1 Speed and Velocity", "Speed is the distance travelled by an object in unit time, while velocity is the displacement of an object in unit time in a given direction. Speed is a scalar quantity because it has only magnitude. Velocity is a vector quantity because it has both magnitude and direction. A car travelling around a circular track at constant speed has a changing velocity because its direction keeps changing."),
        ("1.2 Acceleration", "Acceleration is the rate of change of velocity with time. When the velocity of an object increases, we say the object is accelerating. When the velocity decreases, the object experiences retardation or negative acceleration. The SI unit of acceleration is metre per second squared. An object falling freely near the surface of the Earth accelerates downward at about nine point eight metres per second squared."),
        ("1.3 Equations of Motion", "For uniformly accelerated motion, three equations relate initial velocity, final velocity, acceleration, time and displacement. The first equation states that final velocity equals initial velocity plus acceleration multiplied by time. The second gives displacement as initial velocity times time plus half acceleration times time squared. The third relates the square of final velocity to the square of initial velocity and twice the acceleration times displacement."),
    ]),
    ("Force and Laws of Motion", [
        ("2.1 Newton's First Law", "Newton's first law of motion states that an object remains at rest or in uniform motion in a straight line unless acted upon by an unbalanced external force. This property of matter is called inertia. A passenger lurches forward when a moving bus brakes suddenly because the body tends to continue in its state of motion. The greater the mass of a body, the greater its inertia."),
        ("2.2 Newton's Second Law", "Newton's second law states that the rate of change of momentum of an object is proportional to the applied unbalanced force in the direction of the force. Momentum is the product of mass and velocity. The force acting on an object equals its mass multiplied by its acceleration. The SI unit of force is the newton, defined as the force that gives a one kilogram mass an acceleration of one metre per second squared."),
        ("2.3 Newton's Third Law", "Newton's third law states that to every action there is an equal and opposite reaction. The action and reaction forces act on two different bodies, so they never cancel each other. A rocket moves upward because hot gases are expelled downward at high speed. When a gun is fired the recoil of the gun is the reaction to the forward force on the bullet."),
    ]),
    ("Gravitation", [
        ("3.1 Universal Law of Gravitation", "The universal law of gravitation states that every object in the universe attracts every other object with a force that is directly proportional to the product of their masses and inversely proportional to the square of the distance between them. The constant of proportionality is the universal gravitational constant. This law explains why planets orbit the Sun and why the Moon orbits the Earth."),
        ("3.2 Free Fall and Weight", "Free fall is the motion of an object under the influence of gravity alone. All objects fall with the same acceleration regardless of their mass when air resistance is ignored. The weight of an object is the force with which the Earth attracts it. Weight equals mass multiplied by the acceleration due to gravity, so an object weighs less on the Moon than on the Earth although its mass stays the same."),
        ("3.3 Buoyancy and Flotation", "An object immersed in a fluid experiences an upward force called buoyant force. Archimedes principle states that this force equals the weight of the fluid displaced by the object. An object floats if its density is less than the density of the fluid and sinks if its density is greater. Ships float because their hollow shape displaces a large volume of water."),
    ]),
    ("Work, Energy and Power", [
        ("4.1 Work", "Work is done when a force acts on an object and the object is displaced in the direction of the force. Work equals the force multiplied by the displacement in the direction of the force. The SI unit of work is the joule. No work is done if the displacement is zero, for example when a person pushes against a rigid wall that does not move."),
        ("4.2 Kinetic and Potential Energy", "The energy possessed by an object due to its motion is called kinetic energy and equals half the mass multiplied by the square of the velocity. The energy possessed by an object because of its position or configuration is called potential energy. Gravitational potential energy equals mass times acceleration due to gravity times height. A stretched rubber band stores elastic potential energy."),
        ("4.3 Law of Conservation of Energy", "The law of conservation of energy states that energy can neither be created nor destroyed but only transformed from one form to another. The total energy of an isolated system remains constant. When a ball is dropped, its potential energy decreases while its kinetic energy increases by the same amount. Power is the rate of doing work and its SI unit is the watt."),
    ]),
]


def build_sample_textbook(title: str = "Foundations of Physics") -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm, topMargin=20 * mm, bottomMargin=20 * mm, title=title)
    st = getSampleStyleSheet()
    flow = [Paragraph(title, st["Title"]), Spacer(1, 8 * mm), Paragraph("A sample textbook for the EduAI platform demo.", st["BodyText"]), PageBreak()]
    for n, (name, sections) in enumerate(CHAPTERS, start=1):
        flow.append(Paragraph(f"Chapter {n}: {name}", st["Heading1"]))
        flow.append(Spacer(1, 4 * mm))
        for head, body in sections:
            flow.append(Paragraph(head, st["Heading3"]))
            flow.append(Paragraph(body, st["BodyText"]))
            flow.append(Spacer(1, 3 * mm))
        flow.append(PageBreak())
    doc.build(flow)
    return buf.getvalue()


if __name__ == "__main__":
    from pathlib import Path

    out = Path(__file__).resolve().parents[2] / ".data" / "sample_physics_textbook.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(build_sample_textbook())
    print("Wrote", out)
