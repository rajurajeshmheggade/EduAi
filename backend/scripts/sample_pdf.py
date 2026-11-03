"""Sample multi-chapter physics textbook PDF for demos and tests.

Chapters 1-4 are one page each (pages 2-5; tests read those pages). Chapters 5-6 are Class 10 topics spread over two
pages each, so the AI Classroom demo has a "next page" to prepare while the avatar explains the current one.
"""
import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

# chapter name -> pages -> (heading, body) sections
CHAPTERS = [
    ("Motion", [[
        ("1.1 Speed and Velocity", "Speed is the distance travelled by an object in unit time, while velocity is the displacement of an object in unit time in a given direction. Speed is a scalar quantity because it has only magnitude. Velocity is a vector quantity because it has both magnitude and direction. A car travelling around a circular track at constant speed has a changing velocity because its direction keeps changing."),
        ("1.2 Acceleration", "Acceleration is the rate of change of velocity with time. When the velocity of an object increases, we say the object is accelerating. When the velocity decreases, the object experiences retardation or negative acceleration. The SI unit of acceleration is metre per second squared. An object falling freely near the surface of the Earth accelerates downward at about nine point eight metres per second squared."),
        ("1.3 Equations of Motion", "For uniformly accelerated motion, three equations relate initial velocity, final velocity, acceleration, time and displacement. The first equation states that final velocity equals initial velocity plus acceleration multiplied by time. The second gives displacement as initial velocity times time plus half acceleration times time squared. The third relates the square of final velocity to the square of initial velocity and twice the acceleration times displacement."),
    ]]),
    ("Force and Laws of Motion", [[
        ("2.1 Newton's First Law", "Newton's first law of motion states that an object remains at rest or in uniform motion in a straight line unless acted upon by an unbalanced external force. This property of matter is called inertia. A passenger lurches forward when a moving bus brakes suddenly because the body tends to continue in its state of motion. The greater the mass of a body, the greater its inertia."),
        ("2.2 Newton's Second Law", "Newton's second law states that the rate of change of momentum of an object is proportional to the applied unbalanced force in the direction of the force. Momentum is the product of mass and velocity. The force acting on an object equals its mass multiplied by its acceleration. The SI unit of force is the newton, defined as the force that gives a one kilogram mass an acceleration of one metre per second squared."),
        ("2.3 Newton's Third Law", "Newton's third law states that to every action there is an equal and opposite reaction. The action and reaction forces act on two different bodies, so they never cancel each other. A rocket moves upward because hot gases are expelled downward at high speed. When a gun is fired the recoil of the gun is the reaction to the forward force on the bullet."),
    ]]),
    ("Gravitation", [[
        ("3.1 Universal Law of Gravitation", "The universal law of gravitation states that every object in the universe attracts every other object with a force that is directly proportional to the product of their masses and inversely proportional to the square of the distance between them. The constant of proportionality is the universal gravitational constant. This law explains why planets orbit the Sun and why the Moon orbits the Earth."),
        ("3.2 Free Fall and Weight", "Free fall is the motion of an object under the influence of gravity alone. All objects fall with the same acceleration regardless of their mass when air resistance is ignored. The weight of an object is the force with which the Earth attracts it. Weight equals mass multiplied by the acceleration due to gravity, so an object weighs less on the Moon than on the Earth although its mass stays the same."),
        ("3.3 Buoyancy and Flotation", "An object immersed in a fluid experiences an upward force called buoyant force. Archimedes principle states that this force equals the weight of the fluid displaced by the object. An object floats if its density is less than the density of the fluid and sinks if its density is greater. Ships float because their hollow shape displaces a large volume of water."),
    ]]),
    ("Work, Energy and Power", [[
        ("4.1 Work", "Work is done when a force acts on an object and the object is displaced in the direction of the force. Work equals the force multiplied by the displacement in the direction of the force. The SI unit of work is the joule. No work is done if the displacement is zero, for example when a person pushes against a rigid wall that does not move."),
        ("4.2 Kinetic and Potential Energy", "The energy possessed by an object due to its motion is called kinetic energy and equals half the mass multiplied by the square of the velocity. The energy possessed by an object because of its position or configuration is called potential energy. Gravitational potential energy equals mass times acceleration due to gravity times height. A stretched rubber band stores elastic potential energy."),
        ("4.3 Law of Conservation of Energy", "The law of conservation of energy states that energy can neither be created nor destroyed but only transformed from one form to another. The total energy of an isolated system remains constant. When a ball is dropped, its potential energy decreases while its kinetic energy increases by the same amount. Power is the rate of doing work and its SI unit is the watt."),
    ]]),
    ("Electricity", [
        [
            ("5.1 Electric Current and Circuit", "Electric current is the rate of flow of electric charge through a conductor. It is measured in amperes, and one ampere means one coulomb of charge flowing past a point every second. A continuous and closed path along which current can flow is called an electric circuit; a switch opens or closes the path. An ammeter is connected in series to measure the current. By convention the direction of current is the direction in which positive charge would move, which is opposite to the flow of electrons in a metal wire."),
            ("5.2 Electric Potential and Potential Difference", "Charge flows in a conductor only when there is a difference of electric potential between its ends, just as water flows only when there is a difference of level. The potential difference between two points is the work done to move a unit positive charge from one point to the other. Its unit is the volt: one volt is one joule of work per coulomb of charge. A voltmeter is connected in parallel across the two points whose potential difference is measured. A cell or battery maintains the potential difference that keeps the current flowing."),
            ("5.3 Ohm's Law", "Ohm's law states that the potential difference across the ends of a metallic conductor is directly proportional to the current flowing through it, provided its temperature stays the same. The constant ratio of potential difference to current is the resistance of the conductor, written V equals I times R. Resistance is measured in ohms; a conductor has a resistance of one ohm when a potential difference of one volt drives a current of one ampere through it. For an ohmic conductor a graph of potential difference against current is a straight line through the origin."),
        ],
        [
            ("5.4 Factors on Which Resistance Depends", "The resistance of a uniform wire is directly proportional to its length and inversely proportional to its area of cross-section, and it depends on the material of the wire. This dependence on the material is described by the resistivity, measured in ohm metre. Copper and aluminium have very low resistivity and are used for connecting wires. Alloys such as nichrome have high resistivity and do not oxidise easily at high temperature, so they are used in the heating elements of irons and toasters. The resistance of a metal increases as its temperature rises."),
            ("5.5 Resistors in Series and in Parallel", "When resistors are connected in series the same current flows through each of them, and the total resistance is the sum of the individual resistances. When resistors are connected in parallel the potential difference across each is the same, and the reciprocal of the total resistance is the sum of the reciprocals of the individual resistances, so the total is smaller than the smallest resistor. Household appliances are connected in parallel so that each receives the full supply voltage and can be switched on or off without affecting the others."),
            ("5.6 Heating Effect of Current and Electric Power", "When current flows through a resistor, electrical energy is converted into heat. Joule's law of heating states that the heat produced equals the square of the current multiplied by the resistance and the time. This effect is used in electric heaters, irons and the filament of a bulb, and in a fuse, whose wire melts and breaks the circuit when the current exceeds a safe value. Electric power is the rate at which electrical energy is consumed and equals potential difference multiplied by current; its unit is the watt. Electricity bills use the kilowatt hour, the energy consumed by a one kilowatt appliance in one hour, which equals three point six million joules."),
            ("Worked Example", "A lamp of resistance four ohms is connected to a twelve volt battery. By Ohm's law the current is the potential difference divided by the resistance, that is twelve divided by four, which is three amperes. The power of the lamp is the potential difference multiplied by the current, twelve times three, which is thirty-six watts. In ten minutes, which is six hundred seconds, the lamp uses thirty-six times six hundred joules, that is twenty-one thousand six hundred joules of energy."),
            ("Summary", "Current is the rate of flow of charge and is measured in amperes. Potential difference is work done per unit charge and is measured in volts. Ohm's law links the two through resistance, which depends on the length, thickness and material of a conductor. Series resistances add; parallel resistances combine to give a smaller total. Current heats a conductor, and power is the rate at which electrical energy is used."),
            ("Check Yourself", "One. A current of two amperes flows through a resistor of six ohms; find the potential difference across it. Two. Why are the heating elements of electric irons made of an alloy rather than pure copper? Three. Three resistors of three ohms each are connected in parallel; find their total resistance. Four. Explain why a fuse is connected in series with an appliance and not in parallel."),
        ],
    ]),
    ("Light: Reflection and Refraction", [
        [
            ("6.1 Reflection of Light", "We see an object when light from it reaches our eyes. A polished surface such as a mirror reflects most of the light falling on it. The laws of reflection state that the angle of incidence is equal to the angle of reflection, and that the incident ray, the reflected ray and the normal at the point of incidence all lie in the same plane. The image formed by a plane mirror is virtual and erect, the same size as the object, as far behind the mirror as the object is in front of it, and laterally inverted, which is why the letters of a word appear reversed."),
            ("6.2 Spherical Mirrors", "A spherical mirror is a part of a hollow sphere. A concave mirror has its reflecting surface curved inwards and a convex mirror has it curved outwards. The centre of the mirror surface is the pole, the centre of the sphere is the centre of curvature, and the line joining them is the principal axis. Rays parallel to the principal axis meet after reflection at the principal focus of a concave mirror, and appear to come from the focus of a convex mirror. The focal length is half the radius of curvature. Concave mirrors are used in torches, shaving mirrors and by dentists, and large ones concentrate sunlight in solar furnaces. Convex mirrors are used as rear-view mirrors in vehicles because they always give an erect, diminished image and a wide field of view."),
            ("6.3 Mirror Formula and Magnification", "The mirror formula relates the object distance, the image distance and the focal length: one over the image distance plus one over the object distance equals one over the focal length. Distances are measured from the pole using the New Cartesian sign convention, in which distances measured in the direction of the incident light are positive and those measured against it are negative. The magnification is the height of the image divided by the height of the object, and also equals minus the image distance divided by the object distance. A negative magnification means the image is real and inverted; a positive one means it is virtual and erect."),
        ],
        [
            ("6.4 Refraction of Light", "Light changes direction when it passes obliquely from one transparent medium into another, because its speed changes. This bending is called refraction, and it is why a pencil partly dipped in water looks bent and a pool looks shallower than it is. The laws of refraction state that the incident ray, the refracted ray and the normal lie in one plane, and that the ratio of the sine of the angle of incidence to the sine of the angle of refraction is a constant for a given pair of media; this is Snell's law and the constant is the refractive index. Light bends towards the normal when it enters an optically denser medium. The refractive index of a medium is the speed of light in vacuum divided by the speed of light in that medium; it is about one point three three for water, one point five for glass and two point four two for diamond."),
            ("6.5 Lenses, the Lens Formula and Power", "A lens is a transparent material bounded by two surfaces, at least one of which is curved. A convex lens is thicker in the middle and converges parallel rays to its principal focus; a concave lens is thinner in the middle and diverges them. A lens has an optical centre and a principal focus on each side. The lens formula states that one over the image distance minus one over the object distance equals one over the focal length, and the magnification equals the image distance divided by the object distance. The power of a lens is the reciprocal of its focal length in metres and is measured in dioptres; a convex lens has positive power and a concave lens negative power, which is how spectacle prescriptions are written."),
            ("Worked Example", "An object is placed fifteen centimetres in front of a concave mirror of focal length ten centimetres. Using the sign convention, the object distance is minus fifteen and the focal length is minus ten. From the mirror formula, one over the image distance equals one over the focal length minus one over the object distance, which is minus one tenth plus one fifteenth, equal to minus one thirtieth. The image distance is therefore minus thirty centimetres: the image is real and forms thirty centimetres in front of the mirror. The magnification is minus the image distance divided by the object distance, which is minus two, so the image is inverted and twice the size of the object."),
            ("Summary", "Reflection obeys two laws, and a plane mirror forms a virtual, erect, laterally inverted image. Concave mirrors converge light and convex mirrors diverge it; the mirror formula and the sign convention give the position and size of the image. Refraction is the bending of light when its speed changes between media, described by Snell's law and the refractive index. Lenses converge or diverge light, follow the lens formula, and are rated by their power in dioptres."),
            ("Check Yourself", "One. State the two laws of reflection. Two. Why is a convex mirror preferred as a rear-view mirror in a car? Three. The refractive index of glass is one point five; find the speed of light in glass if its speed in vacuum is three hundred thousand kilometres per second. Four. A convex lens has a focal length of twenty-five centimetres; find its power in dioptres."),
        ],
    ]),
]


def build_sample_textbook(title: str = "Foundations of Physics") -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm, topMargin=20 * mm, bottomMargin=20 * mm, title=title)
    st = getSampleStyleSheet()
    flow = [Paragraph(title, st["Title"]), Spacer(1, 8 * mm), Paragraph("A sample textbook for the EduAI platform demo.", st["BodyText"]), PageBreak()]
    for n, (name, pages) in enumerate(CHAPTERS, start=1):
        for i, sections in enumerate(pages):
            # Only the first page carries the chapter heading, so the indexer sees one chapter spanning both pages.
            flow.append(Paragraph(f"Chapter {n}: {name}" if i == 0 else f"{name} (continued)", st["Heading1" if i == 0 else "Heading3"]))
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
